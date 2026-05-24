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

export interface HardwareAddressSelectorOption {
  addressIndex: number;
  account: HardwareWalletAddress | null;
}

const hardwareAccountStoragePrefix = 'pearl.hardwareWalletAccount.v1';

export function getHardwareAddressSelectorOptions(
  rememberedAccounts: HardwareWalletAddress[],
  activeAccount: HardwareWalletAddress | null,
  selectedVendor: HardwareWalletVendor,
  selectedNetwork: ReturnType<typeof normalizePearlNetwork>,
  selectedAddressIndex: number
): HardwareAddressSelectorOption[] {
  const accountsByIndex = new Map<number, HardwareWalletAddress>();

  for (const account of rememberedAccounts) {
    accountsByIndex.set(account.addressIndex, account);
  }

  if (
    activeAccount &&
    activeAccount.vendor === selectedVendor &&
    activeAccount.network === selectedNetwork
  ) {
    accountsByIndex.set(activeAccount.addressIndex, activeAccount);
  }

  const indexes = new Set([
    ...accountsByIndex.keys(),
    selectedAddressIndex,
  ]);

  return [...indexes]
    .sort((left, right) => left - right)
    .map(addressIndex => ({
      addressIndex,
      account: accountsByIndex.get(addressIndex) ?? null,
    }));
}

export function getNextHardwareWalletAddressIndex(accounts: HardwareWalletAddress[]): number | null {
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
): HardwareWalletAddress[] {
  const accounts = new Map<number, HardwareWalletAddress>();
  const keyPrefix = `${hardwareAccountStoragePrefix}.${network}.${vendor}.`;

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (!key?.startsWith(keyPrefix)) {
        continue;
      }

      const addressIndexText = key.slice(keyPrefix.length);

      if (!/^\d+$/.test(addressIndexText)) {
        continue;
      }

      const rawAccount = storage.getItem(key);

      if (!rawAccount) {
        continue;
      }

      const addressIndex = normalizeHardwareWalletAddressIndex(addressIndexText);
      const account = parseStoredHardwareAccount(
        JSON.parse(rawAccount) as unknown,
        network,
        vendor,
        addressIndex
      );

      if (account) {
        accounts.set(account.addressIndex, account);
      }
    }

    if (!accounts.has(DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX)) {
      const legacyRawAccount = storage.getItem(legacyStorageKeyForHardwareAccount(network, vendor));

      if (legacyRawAccount) {
        const legacyAccount = parseStoredHardwareAccount(
          JSON.parse(legacyRawAccount) as unknown,
          network,
          vendor,
          DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
        );

        if (legacyAccount) {
          accounts.set(legacyAccount.addressIndex, legacyAccount);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to list hardware wallet accounts:', error);
  }

  return [...accounts.values()].sort((left, right) => left.addressIndex - right.addressIndex);
}

export function readStoredHardwareAccount(
  network: ReturnType<typeof normalizePearlNetwork>,
  vendor?: HardwareWalletVendor,
  addressIndex?: number,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): HardwareWalletAddress | null {
  try {
    const storedVendor = vendor ?? storage.getItem(lastVendorStorageKey(network));

    if (!isHardwareWalletVendor(storedVendor)) {
      return null;
    }

    const storedAddressIndex = addressIndex ?? readLastHardwareWalletAddressIndex(
      network,
      storedVendor,
      storage
    );
    const normalizedAddressIndex = normalizeHardwareWalletAddressIndex(storedAddressIndex);
    const rawAccount =
      storage.getItem(storageKeyForHardwareAccount(network, storedVendor, normalizedAddressIndex)) ??
      (
        normalizedAddressIndex === DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
          ? storage.getItem(legacyStorageKeyForHardwareAccount(network, storedVendor))
          : null
      );

    if (!rawAccount) {
      return null;
    }

    const parsedAccount = JSON.parse(rawAccount) as unknown;
    return parseStoredHardwareAccount(parsedAccount, network, storedVendor, normalizedAddressIndex);
  } catch (error) {
    console.warn('Failed to restore hardware wallet account:', error);
    return null;
  }
}

export function saveLastHardwareWalletSelection(
  network: string,
  vendor: HardwareWalletVendor,
  addressIndex: number,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): void {
  try {
    const normalizedAddressIndex = normalizeHardwareWalletAddressIndex(addressIndex);
    storage.setItem(lastVendorStorageKey(network), vendor);
    storage.setItem(lastAddressIndexStorageKey(network, vendor), String(normalizedAddressIndex));
  } catch (error) {
    console.warn('Failed to remember hardware wallet selection:', error);
  }
}

export function saveStoredHardwareAccount(
  account: HardwareWalletAddress,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): void {
  try {
    storage.setItem(
      storageKeyForHardwareAccount(account.network, account.vendor, account.addressIndex),
      JSON.stringify(account)
    );
    saveLastHardwareWalletSelection(account.network, account.vendor, account.addressIndex, storage);
  } catch (error) {
    console.warn('Failed to remember hardware wallet account:', error);
  }
}

export function forgetStoredHardwareAccount(
  network: string,
  vendor: HardwareWalletVendor,
  addressIndex: number,
  storage: HardwareWalletAccountStorage = getDefaultHardwareWalletStorage()
): void {
  try {
    const normalizedAddressIndex = normalizeHardwareWalletAddressIndex(addressIndex);
    storage.removeItem(storageKeyForHardwareAccount(network, vendor, normalizedAddressIndex));

    if (normalizedAddressIndex === DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX) {
      storage.removeItem(legacyStorageKeyForHardwareAccount(network, vendor));
    }

    const lastVendor = storage.getItem(lastVendorStorageKey(network));
    const lastAddressIndex = storage.getItem(lastAddressIndexStorageKey(network, vendor));
    const isLastAddressIndex = lastAddressIndex === String(normalizedAddressIndex) ||
      (
        lastAddressIndex === null &&
        normalizedAddressIndex === DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX
      );

    if (isLastAddressIndex) {
      storage.removeItem(lastAddressIndexStorageKey(network, vendor));
    }

    if (lastVendor === vendor && isLastAddressIndex) {
      storage.removeItem(lastVendorStorageKey(network));
    }
  } catch (error) {
    console.warn('Failed to forget hardware wallet account:', error);
  }
}

function storageKeyForHardwareAccount(
  network: string,
  vendor: HardwareWalletVendor,
  addressIndex: number
): string {
  return `${hardwareAccountStoragePrefix}.${network}.${vendor}.${addressIndex}`;
}

function legacyStorageKeyForHardwareAccount(network: string, vendor: HardwareWalletVendor): string {
  return `${hardwareAccountStoragePrefix}.${network}.${vendor}`;
}

function lastVendorStorageKey(network: string): string {
  return `${hardwareAccountStoragePrefix}.${network}.lastVendor`;
}

function lastAddressIndexStorageKey(network: string, vendor: HardwareWalletVendor): string {
  return `${hardwareAccountStoragePrefix}.${network}.${vendor}.lastAddressIndex`;
}

function readLastHardwareWalletAddressIndex(
  network: ReturnType<typeof normalizePearlNetwork>,
  vendor: HardwareWalletVendor,
  storage: HardwareWalletAccountStorage
): number {
  const rawAddressIndex = storage.getItem(lastAddressIndexStorageKey(network, vendor));

  if (rawAddressIndex === null) {
    return DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX;
  }

  return normalizeHardwareWalletAddressIndex(rawAddressIndex);
}

function parseStoredHardwareAccount(
  value: unknown,
  network: ReturnType<typeof normalizePearlNetwork>,
  vendor: HardwareWalletVendor,
  expectedAddressIndex: number
): HardwareWalletAddress | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const account = value as Partial<HardwareWalletAddress>;

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
      account.addressIndex ??
      getHardwareWalletAddressIndexFromPath(account.path, network, vendor)
    );
  } catch {
    return null;
  }

  if (addressIndex !== expectedAddressIndex) {
    return null;
  }

  const parsedAccount: HardwareWalletAddress = {
    vendor,
    network,
    address: account.address,
    path: account.path,
    publicKey: account.publicKey,
    addressIndex,
  };

  try {
    validateHardwareWalletAccount(parsedAccount);
  } catch {
    return null;
  }

  return parsedAccount;
}

function isHardwareWalletVendor(value: unknown): value is HardwareWalletVendor {
  return value === 'ledger' || value === 'trezor';
}

function getDefaultHardwareWalletStorage(): HardwareWalletAccountStorage {
  return localStorage;
}
