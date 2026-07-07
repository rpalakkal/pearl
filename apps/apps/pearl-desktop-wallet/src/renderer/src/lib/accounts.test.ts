import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  accountDisplayName,
  activeAccountStorageKey,
  buildAccountList,
  enumerateHardwareAccounts,
  hardwareAccountId,
  persistActiveAccountId,
  readPersistedActiveAccountId,
  resolveActiveAccount,
  softwareAccountId,
} from './accounts.ts';
import {account as ledgerFixture, trezorAccount} from './hardwareWalletTestFixtures.ts';
import {saveStoredHardwareAccount, type HardwareWalletAccountStorage} from './hardwareWalletStorage.ts';

function makeFakeStorage(): HardwareWalletAccountStorage & {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

test('account ids are stable and self-describing', () => {
  assert.equal(softwareAccountId('main'), 'software:main');
  assert.equal(hardwareAccountId(ledgerFixture), 'hardware:mainnet:ledger:0');
});

test('buildAccountList merges software and hardware accounts', () => {
  const accounts = buildAccountList(['a', 'b'], [ledgerFixture, trezorAccount]);
  assert.deepEqual(
    accounts.map(a => a.id),
    ['software:a', 'software:b', 'hardware:mainnet:ledger:0', 'hardware:mainnet:trezor:0']
  );
  assert.equal(accounts[2].kind, 'hardware');
  if (accounts[2].kind === 'hardware') {
    assert.equal(accounts[2].address, ledgerFixture.address);
  }
});

test('enumerateHardwareAccounts reads both vendors from storage', () => {
  const storage = makeFakeStorage();
  saveStoredHardwareAccount(ledgerFixture, storage);
  saveStoredHardwareAccount(trezorAccount, storage);

  const accounts = enumerateHardwareAccounts('mainnet', storage);
  assert.deepEqual(
    accounts.map(a => a.vendor),
    ['ledger', 'trezor']
  );
  assert.equal(enumerateHardwareAccounts('testnet', storage).length, 0);
});

test('resolveActiveAccount prefers persisted, then software, then hardware', () => {
  const accounts = buildAccountList(['w1'], [ledgerFixture]);

  assert.equal(resolveActiveAccount(accounts, 'hardware:mainnet:ledger:0')?.id, 'hardware:mainnet:ledger:0');
  assert.equal(resolveActiveAccount(accounts, 'software:gone')?.id, 'software:w1');
  assert.equal(resolveActiveAccount(accounts, null)?.id, 'software:w1');

  const hardwareOnly = buildAccountList([], [ledgerFixture]);
  assert.equal(resolveActiveAccount(hardwareOnly, null)?.id, 'hardware:mainnet:ledger:0');
  assert.equal(resolveActiveAccount([], null), null);
});

test('active account persistence is scoped per network', () => {
  const storage = makeFakeStorage();
  persistActiveAccountId('mainnet', 'software:w1', storage);
  persistActiveAccountId('testnet', 'hardware:testnet:ledger:0', storage);

  assert.equal(readPersistedActiveAccountId('mainnet', storage), 'software:w1');
  assert.equal(readPersistedActiveAccountId('testnet', storage), 'hardware:testnet:ledger:0');
  assert.equal(activeAccountStorageKey('mainnet'), 'pearl.activeAccount.v1.mainnet');
});

test('accountDisplayName labels both kinds', () => {
  const [software, hardware] = buildAccountList(['main'], [ledgerFixture]);
  assert.equal(accountDisplayName(software), 'main');
  assert.equal(accountDisplayName(hardware), 'Ledger #0');
});
