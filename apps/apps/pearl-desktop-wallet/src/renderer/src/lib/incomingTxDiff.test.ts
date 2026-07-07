import assert from 'node:assert/strict';
import test from 'node:test';
import {diffNewReceivedTxs} from './incomingTxDiff.ts';
import type {Transaction} from '../../../types/transaction.ts';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    txid: 'a'.repeat(64),
    type: 'received',
    amount: 1,
    fee: 0,
    confirmations: 1,
    time: 0,
    address: '',
    account: '',
    blockhash: '',
    trusted: false,
    generated: false,
    ...overrides,
  };
}

test('first poll seeds without notifying', () => {
  assert.deepEqual(diffNewReceivedTxs(null, [tx({txid: 'new'})]), []);
});

test('reports only unseen received transactions', () => {
  const seen = new Set(['old']);
  const fresh = tx({txid: 'fresh'});
  const result = diffNewReceivedTxs(seen, [
    fresh,
    tx({txid: 'old'}),
    tx({txid: 'sent-tx', type: 'sent'}),
    tx({txid: 'self-tx', selfTransfer: true}),
  ]);
  assert.deepEqual(result, [fresh]);
});
