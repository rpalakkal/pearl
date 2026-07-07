import assert from 'node:assert/strict';
import test from 'node:test';
import {groupActivities, matchesActivityFilter} from './activityGroups.ts';
import type {Transaction} from '../../../../types/transaction.ts';

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    txid: 'a'.repeat(64),
    type: 'received',
    amount: 1,
    fee: 0,
    confirmations: 3,
    time: 0,
    address: 'prl1qexample',
    account: '',
    blockhash: '',
    trusted: false,
    generated: false,
    ...overrides,
  };
}

const NOW = new Date(2026, 6, 7, 12, 0, 0).getTime(); // local noon

test('filter matches by type and by txid/address substring', () => {
  const sent = tx({type: 'sent', txid: 'deadbeef'.repeat(8), address: 'prl1qrecipient'});

  assert.equal(matchesActivityFilter(sent, 'all', ''), true);
  assert.equal(matchesActivityFilter(sent, 'sent', ''), true);
  assert.equal(matchesActivityFilter(sent, 'received', ''), false);
  assert.equal(matchesActivityFilter(sent, 'all', 'DEADBEEF'), true);
  assert.equal(matchesActivityFilter(sent, 'all', 'recipient'), true);
  assert.equal(matchesActivityFilter(sent, 'all', 'nope'), false);
  assert.equal(matchesActivityFilter(sent, 'sent', 'recipient'), true);
});

test('groups pending first, then Today/Yesterday/date, preserving order', () => {
  const txs = [
    tx({txid: 'p1', confirmations: 0, time: NOW}),
    tx({txid: 't1', time: NOW - 60_000}),
    tx({txid: 't2', time: NOW - 2 * 3_600_000}),
    tx({txid: 'y1', time: NOW - 24 * 3_600_000}),
    tx({txid: 'o1', time: NOW - 5 * 24 * 3_600_000}),
  ];

  const groups = groupActivities(txs, NOW);
  assert.deepEqual(
    groups.map(group => [group.label, group.items.length]),
    [
      ['Pending', 1],
      ['Today', 2],
      ['Yesterday', 1],
      [new Date(NOW - 5 * 24 * 3_600_000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }), 1],
    ]
  );
  assert.deepEqual(groups[1].items.map(item => item.txid), ['t1', 't2']);
});

test('an empty list yields no groups', () => {
  assert.deepEqual(groupActivities([], NOW), []);
});
