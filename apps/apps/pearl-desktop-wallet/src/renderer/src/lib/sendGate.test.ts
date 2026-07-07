import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  evaluateSendGate,
  satsToPearlInput,
  LARGE_SEND_THRESHOLD_PERCENT,
  TEST_SEND_AMOUNT_SATS,
} from './sendGate.ts';

const SPENDABLE = 1_000_000_000n; // 10 PRL
const noHistory = {hasConfirmedSend: false};
const withHistory = {hasConfirmedSend: true};

test('below the threshold passes without history', () => {
  const decision = evaluateSendGate({
    amountSats: SPENDABLE / 10n,
    spendableBalanceSats: SPENDABLE,
    recipient: noHistory,
  });
  assert.deepEqual(decision, {blocked: false, isLargeSend: false});
});

test('at the threshold without history blocks', () => {
  const amountSats = (SPENDABLE * LARGE_SEND_THRESHOLD_PERCENT) / 100n;
  const decision = evaluateSendGate({
    amountSats,
    spendableBalanceSats: SPENDABLE,
    recipient: noHistory,
  });
  assert.equal(decision.blocked, true);
  assert.equal(decision.isLargeSend, true);
});

test('above the threshold with confirmed history passes but stays flagged large', () => {
  const decision = evaluateSendGate({
    amountSats: SPENDABLE,
    spendableBalanceSats: SPENDABLE,
    recipient: withHistory,
  });
  assert.deepEqual(decision, {blocked: false, isLargeSend: true});
});

test('the test amount itself is never gated, even on tiny balances', () => {
  const decision = evaluateSendGate({
    amountSats: TEST_SEND_AMOUNT_SATS,
    spendableBalanceSats: TEST_SEND_AMOUNT_SATS,
    recipient: noHistory,
  });
  assert.equal(decision.blocked, false);
});

test('zero spendable balance never counts as large', () => {
  const decision = evaluateSendGate({
    amountSats: TEST_SEND_AMOUNT_SATS + 1n,
    spendableBalanceSats: 0n,
    recipient: noHistory,
  });
  assert.equal(decision.blocked, false);
});

test('satsToPearlInput renders a plain decimal for amount inputs', () => {
  assert.equal(satsToPearlInput(100_000n), '0.001');
  assert.equal(satsToPearlInput(100_000_000n), '1');
  assert.equal(satsToPearlInput(1n), '0.00000001');
  assert.equal(satsToPearlInput(123_456_789n), '1.23456789');
});

test('suggested test amount clamps to a tenth of small balances, minimum one sat', () => {
  const small = evaluateSendGate({
    amountSats: 200_000n,
    spendableBalanceSats: 300_000n,
    recipient: noHistory,
  });
  assert.equal(small.blocked, true);
  if (small.blocked) {
    assert.equal(small.suggestedTestAmountSats, 30_000n);
  }

  const large = evaluateSendGate({
    amountSats: SPENDABLE,
    spendableBalanceSats: SPENDABLE,
    recipient: noHistory,
  });
  assert.equal(large.blocked, true);
  if (large.blocked) {
    assert.equal(large.suggestedTestAmountSats, TEST_SEND_AMOUNT_SATS);
  }
});
