import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBlockbookBaseUrl,
  normalizeBlockbookAddressTransactions,
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

const OUR = 'prl1qouraddress';
const OTHER = 'prl1qotheraddress';

function historyTx(overrides: Record<string, unknown>) {
  return {
    txid: '11'.repeat(32),
    vin: [{addresses: [OTHER], value: '200000000'}],
    vout: [{addresses: [OUR], value: '100000000'}],
    blockHash: 'ab'.repeat(32),
    blockHeight: 100,
    confirmations: 3,
    blockTime: 1700000000,
    fees: '250',
    ...overrides,
  };
}

test('normalizes a received transaction from address history', () => {
  const {transactions, hasMore} = normalizeBlockbookAddressTransactions(
    {page: 1, totalPages: 1, transactions: [historyTx({})]},
    OUR
  );
  assert.equal(hasMore, false);
  assert.equal(transactions.length, 1);
  const tx = transactions[0];
  assert.equal(tx.type, 'received');
  assert.equal(tx.amount, 1);
  assert.equal(tx.fee, 0);
  assert.equal(tx.confirmations, 3);
  assert.equal(tx.time, 1700000000 * 1000);
  assert.equal(tx.address, OUR);
});

test('normalizes a sent transaction with change and fee', () => {
  const {transactions} = normalizeBlockbookAddressTransactions(
    {
      page: 1,
      totalPages: 1,
      transactions: [
        historyTx({
          vin: [{addresses: [OUR], value: '200000000'}],
          vout: [
            {addresses: [OTHER], value: '150000000'},
            {addresses: [OUR], value: '49999750'}, // change
          ],
        }),
      ],
    },
    OUR
  );
  const tx = transactions[0];
  assert.equal(tx.type, 'sent');
  assert.equal(tx.amount, 1.5);
  assert.equal(tx.fee, 0.0000025);
  assert.equal(tx.address, OTHER);
});

test('self-send is flagged and reports the fee as the net amount', () => {
  const {transactions} = normalizeBlockbookAddressTransactions(
    {
      transactions: [
        historyTx({
          vin: [{addresses: [OUR], value: '100000000'}],
          vout: [{addresses: [OUR], value: '99999750'}],
          fees: '250',
        }),
      ],
    },
    OUR
  );
  assert.equal(transactions[0].type, 'sent');
  assert.equal(transactions[0].selfTransfer, true);
  // Net change is the fee, not the recycled balance.
  assert.equal(transactions[0].amount, 0.0000025);
});

test('mempool transactions tolerate missing block fields', () => {
  const {transactions} = normalizeBlockbookAddressTransactions(
    {
      transactions: [
        historyTx({blockHash: undefined, blockTime: undefined, confirmations: 0}),
      ],
    },
    OUR
  );
  const tx = transactions[0];
  assert.equal(tx.confirmations, 0);
  assert.equal(tx.blockhash, '');
  assert.ok(tx.time > 0);
});

test('malformed history entries are dropped, not fatal', () => {
  const {transactions} = normalizeBlockbookAddressTransactions(
    {
      transactions: [historyTx({}), {txid: 'nope'}, null, 42],
    },
    OUR
  );
  assert.equal(transactions.length, 1);
});

test('pagination fields drive hasMore', () => {
  const paged = normalizeBlockbookAddressTransactions(
    {page: 1, totalPages: 3, transactions: []},
    OUR
  );
  assert.equal(paged.hasMore, true);

  const missing = normalizeBlockbookAddressTransactions({transactions: []}, OUR);
  assert.equal(missing.hasMore, false);
});

test('address history rejects non-object payloads', () => {
  assert.throws(() => normalizeBlockbookAddressTransactions(null, OUR));
  assert.throws(() => normalizeBlockbookAddressTransactions('nope', OUR));
});
