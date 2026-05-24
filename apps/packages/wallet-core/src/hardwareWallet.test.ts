import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSatsAsPearl,
  getHardwareWalletAddressIndexFromPath,
  getPearlHardwareWalletPath,
  normalizeHardwareWalletAddressIndex,
  parsePearlAmountToSats,
} from './hardwareWallet.ts';

test('builds and parses normalized hardware wallet paths', () => {
  assert.equal(getPearlHardwareWalletPath('mainnet', 'ledger', 2), "m/86'/0'/0'/0/2");
  assert.equal(getPearlHardwareWalletPath('testnet', 'trezor', 7), "m/86'/1'/0'/0/7");
  assert.equal(getHardwareWalletAddressIndexFromPath("m/86'/0'/0'/0/2", 'mainnet', 'ledger'), 2);
  assert.equal(normalizeHardwareWalletAddressIndex('3'), 3);
  assert.throws(() => normalizeHardwareWalletAddressIndex(1000), /between 0 and 999/);
});

test('converts Pearl amounts to and from sats', () => {
  assert.equal(parsePearlAmountToSats('1.25000001'), 125000001n);
  assert.equal(formatSatsAsPearl(125000001n), '1.25000001 PRL');
  assert.equal(formatSatsAsPearl(-1050000000n), '-10.5 PRL');
});
