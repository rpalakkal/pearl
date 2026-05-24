import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX,
  derivePearlTaprootAddress,
  formatSatsAsPearl,
  getBitcoinDeviceDisplayAddress,
  getHardwareWalletAddressIndexFromPath,
  getHardwareWalletErrorMessage,
  getPearlHardwareWalletAccountPath,
  getPearlHardwareWalletPath,
  isLedgerUnsupportedTaprootAddressError,
  MAX_HARDWARE_WALLET_ADDRESS_INDEX,
  normalizeHardwareWalletAddressIndex,
  parsePearlAmountToSats,
  previewHardwarePearlSend,
  readLedgerTaprootWalletPublicKey,
  validateHardwareWalletAccount,
  validateHardwareWalletDeviceAccount,
  type HardwareWalletAddress,
} from './hardwareWallet.ts';
import {
  account,
  mainnetAddress,
  publicKey,
  testnetAddress,
  trezorAccount,
} from './hardwareWalletTestFixtures.ts';
import {
  forgetStoredHardwareAccount,
  getHardwareAddressSelectorOptions,
  getNextHardwareWalletAddressIndex,
  listStoredHardwareAccounts,
  readStoredHardwareAccount,
  saveStoredHardwareAccount,
  type HardwareWalletAccountStorage,
} from './hardwareWalletStorage.ts';
import {
  getHardwareBalanceSats,
  getHardwareUtxoValue,
  getSpendableHardwareUtxoValue,
  hardwareAccountKey,
  hasPendingOutgoingHardwareTransaction,
  isPendingHardwareUtxo,
  logHardwareWalletEvent,
  sendPreviewsEqual,
} from '../pages/hardware-wallet/pageModel.ts';

class MemoryStorage implements HardwareWalletAccountStorage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

test('derives Pearl and device-display Taproot addresses from the same output key', () => {
  assert.equal(derivePearlTaprootAddress(publicKey, 'mainnet'), mainnetAddress);
  assert.equal(derivePearlTaprootAddress(publicKey, 'testnet'), testnetAddress);
  assert.equal(
    getBitcoinDeviceDisplayAddress(mainnetAddress, 'mainnet'),
    'bc1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sspknck9'
  );
  assert.equal(
    getBitcoinDeviceDisplayAddress(testnetAddress, 'testnet'),
    'tb1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssk79hv2'
  );
});

test('uses Bitcoin-family BIP86 paths accepted by hardware Bitcoin apps', () => {
  assert.equal(getPearlHardwareWalletPath('mainnet', 'ledger'), "m/86'/0'/0'/0/0");
  assert.equal(getPearlHardwareWalletPath('mainnet', 'trezor'), "m/86'/0'/0'/0/0");
  assert.equal(getPearlHardwareWalletPath('testnet', 'ledger'), "m/86'/1'/0'/0/0");
  assert.equal(getPearlHardwareWalletPath('testnet', 'trezor'), "m/86'/1'/0'/0/0");
  assert.equal(getPearlHardwareWalletPath('mainnet', 'ledger', 2), "m/86'/0'/0'/0/2");
  assert.equal(getPearlHardwareWalletPath('testnet', 'ledger', 999), "m/86'/1'/0'/0/999");
  assert.equal(
    getHardwareWalletAddressIndexFromPath("m/86'/0'/0'/0/2", 'mainnet', 'ledger'),
    2
  );
  assert.equal(getPearlHardwareWalletAccountPath('mainnet', 'ledger'), "m/86'/0'/0'");
  assert.equal(getPearlHardwareWalletAccountPath('testnet', 'trezor'), "m/86'/1'/0'");
  assert.equal(
    normalizeHardwareWalletAddressIndex(DEFAULT_HARDWARE_WALLET_ADDRESS_INDEX),
    0
  );
  assert.equal(
    normalizeHardwareWalletAddressIndex(String(MAX_HARDWARE_WALLET_ADDRESS_INDEX)),
    999
  );
  assert.throws(() => getPearlHardwareWalletPath('mainnet', 'ledger', -1), /address index/);
  assert.throws(() => getPearlHardwareWalletPath('mainnet', 'ledger', 1000), /address index/);
  assert.throws(
    () => getHardwareWalletAddressIndexFromPath("m/86'/1'/0'/0/2", 'mainnet', 'ledger'),
    /unsupported derivation path/
  );
});

test('parses and formats Pearl amounts in satoshis', () => {
  assert.equal(parsePearlAmountToSats('1'), 100_000_000n);
  assert.equal(parsePearlAmountToSats('0.00000001'), 1n);
  assert.equal(parsePearlAmountToSats('12.34000000'), 1_234_000_000n);
  assert.equal(formatSatsAsPearl(1_234_000_000n), '12.34 PRL');
  assert.equal(formatSatsAsPearl(-150n), '-0.0000015 PRL');
  assert.throws(() => parsePearlAmountToSats('0'), /greater than 0 PRL/);
  assert.throws(() => parsePearlAmountToSats('0.000000001'), /up to 8 decimal places/);
});

test('rejects inconsistent stored hardware account metadata before planning', () => {
  const mismatchedAddress = {
    ...account,
    address: testnetAddress,
  };
  const mismatchedPath = {
    ...account,
    path: "m/86'/1'/0'/0/0",
  };
  const mismatchedAddressIndex = {
    ...account,
    path: "m/86'/0'/0'/0/1",
  };
  const secondAddressIndex = {
    ...account,
    path: "m/86'/0'/0'/0/2",
    addressIndex: 2,
  };

  assert.doesNotThrow(() => validateHardwareWalletAccount(secondAddressIndex));
  assert.throws(
    () => validateHardwareWalletAccount(mismatchedAddress),
    /address does not match its public key/
  );
  assert.throws(
    () => previewHardwarePearlSend({
      account: mismatchedPath,
      destinationAddress: mainnetAddress,
      amountSats: 1_000n,
      feeRatePrlPerKb: 0.00001,
      utxos: [{ txid: '00'.repeat(32), vout: 0, value: '10000', confirmations: 1 }],
    }),
    /unsupported derivation path/
  );
  assert.throws(
    () => validateHardwareWalletAccount(mismatchedAddressIndex),
    /unsupported derivation path/
  );
});

test('stores and restores hardware wallet accounts by vendor, network, and address index', () => {
  const storage = new MemoryStorage();
  const ledgerAccount1: HardwareWalletAddress = {
    ...account,
    path: getPearlHardwareWalletPath('mainnet', 'ledger', 1),
    addressIndex: 1,
  };
  const testnetLedgerAccount: HardwareWalletAddress = {
    ...account,
    address: testnetAddress,
    network: 'testnet',
    path: getPearlHardwareWalletPath('testnet', 'ledger', 0),
  };

  saveStoredHardwareAccount(account, storage);
  saveStoredHardwareAccount(ledgerAccount1, storage);
  saveStoredHardwareAccount(trezorAccount, storage);
  saveStoredHardwareAccount(testnetLedgerAccount, storage);

  assert.deepEqual(
    listStoredHardwareAccounts('mainnet', 'ledger', storage).map(storedAccount => storedAccount.addressIndex),
    [0, 1]
  );
  assert.equal(readStoredHardwareAccount('mainnet', 'ledger', 1, storage)?.path, ledgerAccount1.path);
  assert.equal(readStoredHardwareAccount('mainnet', undefined, undefined, storage)?.vendor, 'trezor');
  assert.equal(readStoredHardwareAccount('testnet', 'ledger', 0, storage)?.address, testnetAddress);

  forgetStoredHardwareAccount('mainnet', 'ledger', 1, storage);

  assert.deepEqual(
    listStoredHardwareAccounts('mainnet', 'ledger', storage).map(storedAccount => storedAccount.addressIndex),
    [0]
  );
  assert.equal(readStoredHardwareAccount('mainnet', 'ledger', 1, storage), null);
});

test('migrates legacy index-zero hardware wallet storage without leaking it to other slots', () => {
  const storage = new MemoryStorage();
  const legacyAccount = { ...account };
  delete (legacyAccount as Partial<HardwareWalletAddress>).addressIndex;

  storage.setItem('pearl.hardwareWalletAccount.v1.mainnet.ledger', JSON.stringify(legacyAccount));
  storage.setItem('pearl.hardwareWalletAccount.v1.mainnet.lastVendor', 'ledger');

  assert.equal(readStoredHardwareAccount('mainnet', 'ledger', 0, storage)?.addressIndex, 0);
  assert.equal(readStoredHardwareAccount('mainnet', 'ledger', 1, storage), null);
  assert.deepEqual(
    listStoredHardwareAccounts('mainnet', 'ledger', storage).map(storedAccount => storedAccount.addressIndex),
    [0]
  );
});

test('builds address selector options from remembered and active hardware accounts', () => {
  const ledgerAccount2: HardwareWalletAddress = {
    ...account,
    path: getPearlHardwareWalletPath('mainnet', 'ledger', 2),
    addressIndex: 2,
  };
  const activeLedgerAccount3: HardwareWalletAddress = {
    ...account,
    path: getPearlHardwareWalletPath('mainnet', 'ledger', 3),
    addressIndex: 3,
  };

  assert.deepEqual(
    getHardwareAddressSelectorOptions([account, ledgerAccount2], null, 'ledger', 'mainnet', 1)
      .map(option => [option.addressIndex, Boolean(option.account)]),
    [
      [0, true],
      [1, false],
      [2, true],
    ]
  );
  assert.deepEqual(
    getHardwareAddressSelectorOptions([account, ledgerAccount2], activeLedgerAccount3, 'ledger', 'mainnet', 3)
      .map(option => [option.addressIndex, Boolean(option.account)]),
    [
      [0, true],
      [2, true],
      [3, true],
    ]
  );
  assert.equal(getNextHardwareWalletAddressIndex([account, ledgerAccount2]), 3);
});

test('rejects signing with a device that does not match the stored hardware account', () => {
  const otherPublicKey = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

  assert.doesNotThrow(() => validateHardwareWalletDeviceAccount(
    account,
    publicKey,
    getBitcoinDeviceDisplayAddress(account.address, account.network)
  ));
  assert.throws(
    () => validateHardwareWalletDeviceAccount(account, otherPublicKey),
    /does not match this Pearl hardware account/
  );
  assert.throws(
    () => validateHardwareWalletDeviceAccount(account, publicKey, getBitcoinDeviceDisplayAddress(testnetAddress, 'testnet')),
    /returned a different address/
  );
});

test('maps common device access errors to actionable hardware wallet messages', () => {
  assert.equal(
    getHardwareWalletErrorMessage(new Error('Access denied to use Ledger device'), 'ledger'),
    'No Ledger was selected. Connect and unlock the device, open the Bitcoin app, then try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('Access denied to use Trezor device'), 'trezor'),
    'No Trezor was selected. Connect and unlock the device, then try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('navigator.hid is not supported'), 'ledger'),
    'Ledger device access is not available in this Electron runtime.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('navigator.usb is not supported'), 'trezor'),
    'Trezor device access is not available in this Electron runtime.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('signPsbtBuffer is not supported with the legacy Bitcoin app'), 'ledger'),
    'Update the Ledger Bitcoin app in Ledger Live to a Taproot-capable version, then quit Ledger Live, reopen the Bitcoin app on the device, and try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('Unsupported address format bech32m'), 'ledger'),
    'Update the Ledger Bitcoin app in Ledger Live to a Taproot-capable version, then quit Ledger Live, reopen the Bitcoin app on the device, and try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('Ledger device: UNKNOWN_ERROR (0x6d09)'), 'ledger'),
    'Ledger returned a transient connection error. Keep the Bitcoin app open, reconnect the Ledger if needed, and try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('Device is locked'), 'trezor'),
    'Unlock your Trezor and try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('Unable to establish connection with iframe'), 'trezor'),
    'Trezor Connect did not load. Check your internet connection and try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(
      new Error("Cannot read properties of undefined (reading 'trim')"),
      'trezor'
    ),
    'Trezor signing was cancelled or did not complete. Close the popup and try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(
      new Error('Initialize failed: Cancelled, code: Failure_ActionCancelled'),
      'trezor'
    ),
    'Trezor signing was cancelled or did not complete. Close the popup and try again.'
  );
  assert.equal(
    getHardwareWalletErrorMessage(new Error('Browser_LocalNetworkPermissionMissing'), 'trezor'),
    'Trezor Connect needs local network access to reach Trezor Suite or Trezor Bridge.'
  );
});

test('falls back to a Ledger legacy public-key read only when address display is not requested', async () => {
  const formats: string[] = [];
  const response = await readLedgerTaprootWalletPublicKey(async format => {
    formats.push(format);

    if (format === 'bech32m') {
      throw new Error('Unsupported address format bech32m');
    }

    return {
      publicKey,
      bitcoinAddress: '1LedgerLegacyAddressForTheSamePublicKey',
    };
  }, false);

  assert.deepEqual(formats, ['bech32m', 'legacy']);
  assert.equal(response.publicKey, publicKey);
  assert.equal(response.bitcoinAddress, '');
  assert.equal(
    isLedgerUnsupportedTaprootAddressError(new Error('signPsbtBuffer is not supported with the legacy Bitcoin app')),
    true
  );

  await assert.rejects(
    readLedgerTaprootWalletPublicKey(async () => {
      throw new Error('Unsupported address format bech32m');
    }, true),
    /Unsupported address format bech32m/
  );
});

test('models spendable hardware balances without spending pending funds', () => {
  const confirmedUtxo = { txid: '11'.repeat(32), vout: 0, value: '1000', confirmations: 1 };
  const pendingUtxo = { txid: '22'.repeat(32), vout: 0, value: '5000', confirmations: 0 };

  assert.equal(isPendingHardwareUtxo(confirmedUtxo), false);
  assert.equal(isPendingHardwareUtxo(pendingUtxo), true);
  assert.equal(getHardwareUtxoValue(confirmedUtxo), 1000n);
  assert.equal(getHardwareUtxoValue({ ...confirmedUtxo, value: '-1' }), 0n);
  assert.equal(getSpendableHardwareUtxoValue(confirmedUtxo), 1000n);
  assert.equal(getSpendableHardwareUtxoValue(pendingUtxo), 0n);
  assert.equal(getHardwareBalanceSats('-2500'), -2500n);
  assert.equal(getHardwareBalanceSats('not-a-number'), 0n);
  assert.equal(hasPendingOutgoingHardwareTransaction({
    address: account.address,
    balance: '0',
    totalReceived: '0',
    totalSent: '0',
    unconfirmedBalance: '-1',
    unconfirmedTxs: 1,
    txs: 1,
  }), true);
});

test('compares send previews by selected outpoints and device display address', () => {
  const left = previewHardwarePearlSend({
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{ txid: '11'.repeat(32), vout: 0, value: '100000', confirmations: 1 }],
  });
  const same = previewHardwarePearlSend({
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{ txid: '11'.repeat(32), vout: 0, value: '100000', confirmations: 1 }],
  });
  const differentInput = previewHardwarePearlSend({
    account,
    destinationAddress: mainnetAddress,
    amountSats: 50_000n,
    feeRatePrlPerKb: 0.00001,
    utxos: [{ txid: '22'.repeat(32), vout: 0, value: '100000', confirmations: 1 }],
  });

  assert.equal(sendPreviewsEqual(left, same), true);
  assert.equal(sendPreviewsEqual(left, differentInput), false);
  assert.equal(hardwareAccountKey(account), [
    account.network,
    account.vendor,
    account.addressIndex,
    account.path,
    account.address,
    account.publicKey,
  ].join('.'));
});

test('emits structured hardware wallet diagnostics', () => {
  const messages: string[] = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.info = message => { messages.push(String(message)); };
  console.warn = message => { messages.push(String(message)); };
  console.error = message => { messages.push(String(message)); };

  try {
    logHardwareWalletEvent('connect:start', {
      address: 'prl1p1234567890abcdef',
      empty: '',
      network: 'mainnet',
      skipped: null,
    });
    logHardwareWalletEvent('send:pending-outgoing', { pendingOutgoing: true }, 'warn');
    logHardwareWalletEvent('send:error', { error: 'failed' }, 'error');
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(messages, [
    '[HardwareWallet] connect:start address=prl1p1234567890abcdef network=mainnet',
    '[HardwareWallet] send:pending-outgoing pendingOutgoing=true',
    '[HardwareWallet] send:error error=failed',
  ]);
});
