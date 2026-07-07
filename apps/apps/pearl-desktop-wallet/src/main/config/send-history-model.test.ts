import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  deriveRecipientStatus,
  isSendHistoryRecord,
  pearlAmountToSatsString,
  recordsForRecipient,
  type SendHistoryRecord,
} from './send-history-model.ts';

function record(overrides: Partial<SendHistoryRecord>): SendHistoryRecord {
  return {
    id: 'id',
    recipientAddress: 'prl1qrecipient',
    txid: 'tx1',
    amountSats: '100000',
    network: 'mainnet',
    source: 'software',
    createdAt: 1000,
    ...overrides,
  };
}

test('no records means no history', () => {
  const status = deriveRecipientStatus([]);
  assert.deepEqual(status, {
    hasAnySend: false,
    hasConfirmedSend: false,
    hasPendingSend: false,
    lastSendAt: null,
  });
});

test('unconfirmed record is pending, not confirmed', () => {
  const status = deriveRecipientStatus([record({})]);
  assert.equal(status.hasAnySend, true);
  assert.equal(status.hasConfirmedSend, false);
  assert.equal(status.hasPendingSend, true);
  assert.equal(status.lastSendAt, 1000);
});

test('confirmedAt marks the recipient as confirmed', () => {
  const status = deriveRecipientStatus([record({confirmedAt: 2000})]);
  assert.equal(status.hasConfirmedSend, true);
  assert.equal(status.hasPendingSend, false);
});

test('fresh confirmation lookups confirm by txid', () => {
  const status = deriveRecipientStatus([record({txid: 'tx9'})], new Map([['tx9', 3]]));
  assert.equal(status.hasConfirmedSend, true);
});

test('zero confirmations stay pending (fail closed)', () => {
  const status = deriveRecipientStatus([record({txid: 'tx9'})], new Map([['tx9', 0]]));
  assert.equal(status.hasConfirmedSend, false);
  assert.equal(status.hasPendingSend, true);
});

test('recordsForRecipient matches case-insensitively and scopes by network', () => {
  const records = [
    record({id: '1', recipientAddress: 'PRL1QRecipient '}),
    record({id: '2', network: 'testnet'}),
    record({id: '3', recipientAddress: 'prl1qother'}),
  ];
  const matched = recordsForRecipient(records, 'prl1qrecipient', 'mainnet');
  assert.deepEqual(matched.map(r => r.id), ['1']);
});

test('isSendHistoryRecord rejects malformed records', () => {
  assert.equal(isSendHistoryRecord(record({})), true);
  assert.equal(isSendHistoryRecord({...record({}), amountSats: 100000}), false);
  assert.equal(isSendHistoryRecord({...record({}), network: 'regtest'}), false);
  assert.equal(isSendHistoryRecord(null), false);
});

test('pearlAmountToSatsString converts without float drift', () => {
  assert.equal(pearlAmountToSatsString(0.001), '100000');
  assert.equal(pearlAmountToSatsString(1), '100000000');
  assert.equal(pearlAmountToSatsString(0.00000001), '1');
  assert.equal(pearlAmountToSatsString(12.34567891), '1234567891');
});
