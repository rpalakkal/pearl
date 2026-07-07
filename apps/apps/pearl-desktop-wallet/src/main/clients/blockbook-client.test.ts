import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBlockbookBaseUrl,
  normalizeBlockbookFeeRate,
  normalizeBlockbookFeeTarget,
  normalizeBlockbookNetwork,
  normalizeBlockbookTxid,
  normalizeRawTransactionHex,
} from './blockbook-normalizers.ts';

test('normalizes Blockbook fee estimates and validates fee target input', () => {
  assert.throws(() => normalizeBlockbookFeeTarget(0), /Invalid Blockbook fee target/);
  assert.throws(() => normalizeBlockbookFeeTarget(1.5), /Invalid Blockbook fee target/);
  assert.throws(() => normalizeBlockbookFeeTarget(1009), /Invalid Blockbook fee target/);

  assert.equal(normalizeBlockbookFeeTarget(1), 1);
  assert.equal(normalizeBlockbookFeeRate('0.00001000'), 0.00001);
  assert.equal(normalizeBlockbookFeeRate(0.00002), 0.00002);
  assert.throws(() => normalizeBlockbookFeeRate('0'), /invalid fee estimate/);
});

test('normalizes explicit Blockbook networks and routes to the matching backend', () => {
  assert.equal(normalizeBlockbookNetwork(undefined), 'mainnet');
  assert.equal(normalizeBlockbookNetwork('mainnet'), 'mainnet');
  assert.equal(normalizeBlockbookNetwork('testnet'), 'testnet');
  assert.throws(() => normalizeBlockbookNetwork('regtest'), /Invalid Blockbook network request/);

  assert.equal(getBlockbookBaseUrl('mainnet'), 'https://blockbook.pearlresearch.ai');
  assert.equal(getBlockbookBaseUrl('testnet'), 'https://blockbook.testnet.pearlresearch.ai');
});


test('validates transaction hex and normalizes broadcast txid responses', () => {
  assert.throws(() => normalizeRawTransactionHex('not hex'), /Invalid transaction hex/);
  assert.throws(() => normalizeRawTransactionHex('abc'), /Invalid transaction hex/);
  assert.equal(normalizeRawTransactionHex(' 00AA '), '00AA');
  assert.equal(
    normalizeBlockbookTxid('BB'.repeat(32), 'broadcast transaction id'),
    'bb'.repeat(32)
  );
  assert.throws(
    () => normalizeBlockbookTxid('not-a-txid', 'broadcast transaction id'),
    /invalid broadcast transaction id/
  );
});

// ---- Address transaction history normalizer ----
