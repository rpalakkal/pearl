import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBlockbookBaseUrl,
  normalizeBlockbookAddress,
  normalizeBlockbookAddressInfo,
  normalizeBlockbookFeeRate,
  normalizeBlockbookFeeTarget,
  normalizeBlockbookNetwork,
  normalizeBlockbookTransactionConfirmations,
  normalizeBlockbookTxid,
  normalizeBlockbookUtxoList,
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

test('normalizes addresses and address info including signed unconfirmed balances', () => {
  assert.equal(normalizeBlockbookAddress(' prl1ptestaddress '), 'prl1ptestaddress');
  assert.throws(() => normalizeBlockbookAddress(''), /Invalid Blockbook address request/);

  const info = normalizeBlockbookAddressInfo(
    {
      address: 'prl1ptestaddress',
      balance: 100,
      totalReceived: '500',
      totalSent: '400',
      unconfirmedBalance: '-25',
      unconfirmedTxs: 1,
      txs: 2,
    },
    'prl1ptestaddress'
  );

  assert.deepEqual(info, {
    address: 'prl1ptestaddress',
    balance: '100',
    totalReceived: '500',
    totalSent: '400',
    unconfirmedBalance: '-25',
    unconfirmedTxs: 1,
    txs: 2,
  });
});

test('rejects address info for a different address', () => {
  assert.throws(
    () =>
      normalizeBlockbookAddressInfo(
        {
          address: 'prl1pother',
          balance: '0',
          totalReceived: '0',
          totalSent: '0',
          unconfirmedBalance: '0',
          unconfirmedTxs: 0,
          txs: 0,
        },
        'prl1prequested'
      ),
    /different address/
  );
});

test('normalizes UTXOs and rejects malformed UTXO responses', () => {
  assert.deepEqual(
    normalizeBlockbookUtxoList([
      {
        txid: 'AA'.repeat(32),
        vout: 1,
        value: 12_345,
        height: 10,
        confirmations: 3,
      },
    ]),
    [
      {
        txid: 'aa'.repeat(32),
        vout: 1,
        value: '12345',
        height: 10,
        confirmations: 3,
      },
    ]
  );

  assert.throws(
    () => normalizeBlockbookUtxoList([{txid: 'not-a-txid', vout: 0, value: '1'}]),
    /invalid UTXO transaction id/
  );
  assert.throws(
    () => normalizeBlockbookUtxoList([{txid: '11'.repeat(32), vout: 0, value: '-1'}]),
    /invalid UTXO value/
  );
});

test('normalizes transaction confirmations for UTXO confirmation hydration', () => {
  assert.equal(
    normalizeBlockbookTransactionConfirmations(
      {
        txid: 'AA'.repeat(32),
        confirmations: 2,
      },
      'aa'.repeat(32)
    ),
    2
  );

  assert.throws(
    () =>
      normalizeBlockbookTransactionConfirmations(
        {
          txid: 'BB'.repeat(32),
          confirmations: 2,
        },
        'aa'.repeat(32)
      ),
    /different txid/
  );
  assert.throws(
    () =>
      normalizeBlockbookTransactionConfirmations(
        {
          txid: 'AA'.repeat(32),
          confirmations: -1,
        },
        'aa'.repeat(32)
      ),
    /invalid transaction confirmation count/
  );
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
