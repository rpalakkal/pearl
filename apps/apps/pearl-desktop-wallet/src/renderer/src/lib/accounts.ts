/**
 * Unified account model: seed-based software wallets and hardware accounts
 * presented as one list. Pure helpers here; live state in accountsStore.
 */
import {
  listStoredHardwareAccounts,
  type HardwareWalletAccountStorage,
  type StoredHardwareAccount,
} from './hardwareWalletStorage.ts';
import type {PearlNetwork} from './hardwareWallet.ts';

export type WalletAccount =
  | {kind: 'software'; id: string; name: string}
  | ({kind: 'hardware'; id: string} & StoredHardwareAccount);

export function softwareAccountId(name: string): string {
  return `software:${name}`;
}

// The address is derived from the device public key, so it uniquely
// identifies a physical device + network + address index. Keying the id by
// address (not index) lets accounts from two same-vendor devices coexist.
export function hardwareAccountId(account: {
  network: string;
  vendor: string;
  address: string;
}): string {
  return `hardware:${account.network}:${account.vendor}:${account.address}`;
}

export function enumerateHardwareAccounts(
  network: PearlNetwork,
  storage?: HardwareWalletAccountStorage
): StoredHardwareAccount[] {
  return [
    ...listStoredHardwareAccounts(network, 'ledger', storage),
    ...listStoredHardwareAccounts(network, 'trezor', storage),
  ];
}

export function buildAccountList(
  walletNames: string[],
  hardwareAccounts: StoredHardwareAccount[]
): WalletAccount[] {
  return [
    ...walletNames.map(name => ({
      kind: 'software' as const,
      id: softwareAccountId(name),
      name,
    })),
    ...hardwareAccounts.map(account => ({
      kind: 'hardware' as const,
      id: hardwareAccountId(account),
      ...account,
    })),
  ];
}

// Which account to activate: the persisted choice when it still exists,
// otherwise the first software wallet, otherwise the first hardware account.
export function resolveActiveAccount(
  accounts: WalletAccount[],
  persistedId: string | null
): WalletAccount | null {
  return (
    accounts.find(account => account.id === persistedId) ??
    accounts.find(account => account.kind === 'software') ??
    accounts[0] ??
    null
  );
}

const ACTIVE_ACCOUNT_KEY_PREFIX = 'pearl.activeAccount.v1';

export function activeAccountStorageKey(network: string): string {
  return `${ACTIVE_ACCOUNT_KEY_PREFIX}.${network}`;
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readPersistedActiveAccountId(
  network: string,
  storage: KeyValueStorage = localStorage
): string | null {
  try {
    return storage.getItem(activeAccountStorageKey(network));
  } catch {
    return null;
  }
}

export function persistActiveAccountId(
  network: string,
  id: string,
  storage: KeyValueStorage = localStorage
): void {
  try {
    storage.setItem(activeAccountStorageKey(network), id);
  } catch (error) {
    console.warn('Failed to persist active account:', error);
  }
}

export function accountDisplayName(account: WalletAccount): string {
  if (account.kind === 'software') {
    return account.name;
  }
  const label = account.label?.trim();
  if (label) {
    return label;
  }
  return defaultHardwareAccountName(account);
}

export function defaultHardwareAccountName(account: {
  vendor: string;
  addressIndex: number;
}): string {
  const vendorLabel = account.vendor === 'ledger' ? 'Ledger' : 'Trezor';
  return `${vendorLabel} #${account.addressIndex}`;
}
