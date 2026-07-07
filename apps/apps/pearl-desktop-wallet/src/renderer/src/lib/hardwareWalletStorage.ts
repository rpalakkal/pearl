import {
  DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX,
  MAX_HARDWARE_WALLET_ADDRESS_INDEX,
  getHardwareWalletAddressIndexFromPath,
  normalizeHardwareWalletAddressIndex,
  normalizePearlNetwork,
  validateHardwareWalletAccount,
  type HardwareWalletAddress,
  type HardwareWalletVendor,
} from './hardwareWallet.ts';

export interface HardwareWalletAccountStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// A remembered hardware account plus renderer-only metadata. The wallet-core
// HardwareWalletAddress stays label-free; signing code never needs it.
export interface StoredHardwareAccount extends HardwareWalletAddress {
  label?: string;
}

export const HARDWARE_ACCOUNT_LABEL_MAX_LENGTH = 64;

// Records are keyed by network.vendor.address — the address is derived from
// the device public key, so accounts from two same-vendor devices coexist
// even at the same address index. (v1 keyed by index and collided.)
const hardwareAccountStoragePrefix = 'pearl.hardwareWalletAccount.v2';

export function getNextHardwareWalletAddressIndex(
  accounts: HardwareWalletAddress[]
): number | null {
  const usedIndexes = new Set(accounts.map(account => account.addressIndex));
  const highestUsedIndex = accounts.reduce(
    (highest, account) => Math.max(highest, account.addressIndex),
    DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX - 1
  );

  for (
    let addressIndex = Math.max(DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX, highestUsedIndex + 1);
    addressIndex <= MAX_HARDWARE_WALLET_ADDRESS_INDEX;
    addressIndex += 1
  ) {
    if (!usedIndexes.has(addressIndex)) {
      return addressIndex;
    }
  }

  for (
    let addressIndex = DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX;
    addressIndex <= MAX_HARDWARE_WALLET_ADDRESS_INDEX;
    addressIndex += 1
  ) {
    if (!usedIndexes.has(addressIndex)) {
      return addressIndex;
    }
  }

  return null;
}

export function listStoredHardwareAccounts(
  network: ReturnType<typeof normalizePearlNetwork>,
  vendor: HardwareWalletVendor,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): StoredHardwareAccount[] {
  const accounts = new Map<string, StoredHardwareAccount>();
  const keyPrefix = `${hardwareAccountStoragePrefix}.${network}.${vendor}.`;

  try {
    for (const key of listStorageKeys(storage)) {
      if (!key.startsWith(keyPrefix)) {
        continue;
      }

      const address = key.slice(keyPrefix.length);
      const rawAccount = storage.getItem(key);

      if (!address || !rawAccount) {
        continue;
      }

      // A corrupt record only hides itself, not the rest of the scan.
      let account: StoredHardwareAccount | null = null;
      try {
        account = parseStoredHardwareAccount(JSON.parse(rawAccount) as unknown, network, vendor);
      } catch {
        console.warn(`Ignoring unreadable hardware account record: ${key}`);
      }

      if (account && account.address === address) {
        accounts.set(account.address, account);
      }
    }
  } catch (error) {
    console.warn('Failed to list hardware wallet accounts:', error);
  }

  return [...accounts.values()].sort(
    (left, right) =>
      left.addressIndex - right.addressIndex || left.address.localeCompare(right.address)
  );
}

export function saveStoredHardwareAccount(
  account: StoredHardwareAccount,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): void {
  try {
    const key = storageKeyForHardwareAccount(account.network, account.vendor, account.address);

    // Reconnecting a known device must never wipe its user-given name.
    let label = normalizeHardwareAccountLabel(account.label);
    if (label === undefined) {
      const rawExisting = storage.getItem(key);
      const existing = rawExisting
        ? parseStoredHardwareAccount(
            JSON.parse(rawExisting) as unknown,
            account.network,
            account.vendor
          )
        : null;
      label = existing?.label;
    }

    const record: StoredHardwareAccount = {
      vendor: account.vendor,
      network: account.network,
      address: account.address,
      path: account.path,
      publicKey: account.publicKey,
      addressIndex: account.addressIndex,
      ...(label !== undefined ? {label} : {}),
    };

    storage.setItem(key, JSON.stringify(record));
  } catch (error) {
    console.warn('Failed to remember hardware wallet account:', error);
  }
}

// Sets or clears (label = null / blank) the user-given account name. The
// storage key and account id never include the label, so renames are
// identity-stable.
export function renameStoredHardwareAccount(
  network: string,
  vendor: HardwareWalletVendor,
  address: string,
  label: string | null,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): void {
  try {
    const key = storageKeyForHardwareAccount(network, vendor, address);
    const rawAccount = storage.getItem(key);

    if (!rawAccount) {
      return;
    }

    const account = JSON.parse(rawAccount) as Record<string, unknown>;
    const normalizedLabel = normalizeHardwareAccountLabel(label ?? undefined);

    if (normalizedLabel === undefined) {
      delete account.label;
    } else {
      account.label = normalizedLabel;
    }

    storage.setItem(key, JSON.stringify(account));
  } catch (error) {
    console.warn('Failed to rename hardware wallet account:', error);
  }
}

export function forgetStoredHardwareAccount(
  network: string,
  vendor: HardwareWalletVendor,
  address: string,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): void {
  try {
    storage.removeItem(storageKeyForHardwareAccount(network, vendor, address));
  } catch (error) {
    console.warn('Failed to forget hardware wallet account:', error);
  }
}

function storageKeyForHardwareAccount(
  network: string,
  vendor: HardwareWalletVendor,
  address: string
): string {
  return `${hardwareAccountStoragePrefix}.${network}.${vendor}.${address}`;
}

function listStorageKeys(storage: HardwareWalletAccountStorage): string[] {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (key !== null) {
      keys.push(key);
    }
  }

  return keys;
}

function normalizeHardwareAccountLabel(label: unknown): string | undefined {
  if (typeof label !== 'string') {
    return undefined;
  }

  const trimmed = label.trim().slice(0, HARDWARE_ACCOUNT_LABEL_MAX_LENGTH);
  return trimmed ? trimmed : undefined;
}

function parseStoredHardwareAccount(
  value: unknown,
  network: ReturnType<typeof normalizePearlNetwork>,
  vendor: HardwareWalletVendor
): StoredHardwareAccount | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const account = value as Partial<StoredHardwareAccount>;

  if (
    account.vendor !== vendor ||
    account.network !== network ||
    typeof account.address !== 'string' ||
    typeof account.path !== 'string' ||
    typeof account.publicKey !== 'string'
  ) {
    return null;
  }

  let addressIndex: number;

  try {
    addressIndex = normalizeHardwareWalletAddressIndex(
      account.addressIndex ?? getHardwareWalletAddressIndexFromPath(account.path, network, vendor)
    );
  } catch {
    return null;
  }

  const label = normalizeHardwareAccountLabel(account.label);
  const parsedAccount: StoredHardwareAccount = {
    vendor,
    network,
    address: account.address,
    path: account.path,
    publicKey: account.publicKey,
    addressIndex,
    ...(label !== undefined ? {label} : {}),
  };

  try {
    validateHardwareWalletAccount(parsedAccount);
  } catch {
    return null;
  }

  return parsedAccount;
}

function getDefaultHardwareWalletStorage(): HardwareWalletAccountStorage {
  return localStorage;
}
