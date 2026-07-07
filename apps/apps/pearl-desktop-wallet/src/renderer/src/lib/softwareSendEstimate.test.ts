import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateTaprootFeeSats} from './hardwareWallet.ts';
import {
  estimateSoftwareSendFee,
  maxSpendableSoftwareSats,
  prlToSats,
  spendableUtxoSats,
} from './softwareSendEstimate.ts';

const FEE_RATE = 0.0001; // PRL/kB → 10 sats/vbyte

test('converts listunspent float amounts to sats without drift', () => {
  assert.equal(prlToSats(1), 100_000_000n);
  assert.equal(prlToSats(0.00000001), 1n);
  assert.equal(prlToSats(0.1 + 0.2), 30_000_000n); // classic float tail
  assert.equal(prlToSats(-1), 0n);
  assert.equal(prlToSats(Number.NaN), 0n);
});

test('filters unconfirmed and unspendable outputs and sorts largest first', () => {
  const sats = spendableUtxoSats([
    {txid: 'a', vout: 0, amount: 0.5, confirmations: 3, spendable: true},
    {txid: 'b', vout: 0, amount: 2, confirmations: 1, spendable: true},
    {txid: 'c', vout: 0, amount: 9, confirmations: 0, spendable: true}, // pending
    {txid: 'd', vout: 0, amount: 9, confirmations: 5, spendable: false}, // locked
  ]);
  assert.deepEqual(sats, [200_000_000n, 50_000_000n]);
});

test('estimates fee with change when change clears dust', () => {
  const utxos = [100_000_000n];
  const estimate = estimateSoftwareSendFee(utxos, 50_000_000n, FEE_RATE);
  assert.ok(estimate);
  assert.equal(estimate.inputCount, 1);
  assert.equal(estimate.feeSats, estimateTaprootFeeSats(1, 2, FEE_RATE));
  assert.equal(estimate.totalDebitSats, 50_000_000n + estimate.feeSats);
});

test('sweeps sub-dust change into the fee', () => {
  const utxos = [100_000_000n];
  const noChangeFee = estimateTaprootFeeSats(1, 1, FEE_RATE);
  const amount = 100_000_000n - noChangeFee - 10n; // leaves 10 sats — below dust
  const estimate = estimateSoftwareSendFee(utxos, amount, FEE_RATE);
  assert.ok(estimate);
  assert.equal(estimate.feeSats, noChangeFee + 10n);
  assert.equal(estimate.totalDebitSats, 100_000_000n);
});

test('accumulates inputs largest-first until the amount plus fee is covered', () => {
  const utxos = [10_000_000n, 30_000_000n, 20_000_000n];
  // 30M alone can't cover 45M; 30M+20M can (largest-first, unsorted input).
  const estimate = estimateSoftwareSendFee(utxos, 45_000_000n, FEE_RATE);
  assert.ok(estimate);
  assert.equal(estimate.inputCount, 2);

  const sweep = estimateSoftwareSendFee(utxos, 59_000_000n, FEE_RATE);
  assert.ok(sweep);
  assert.equal(sweep.inputCount, 3);
});

test('returns null when funds are insufficient or inputs are invalid', () => {
  assert.equal(estimateSoftwareSendFee([1_000n], 1_000_000n, FEE_RATE), null);
  assert.equal(estimateSoftwareSendFee([], 1_000n, FEE_RATE), null);
  assert.equal(estimateSoftwareSendFee([100_000_000n], 0n, FEE_RATE), null);
  assert.equal(estimateSoftwareSendFee([100_000_000n], 1_000n, 0), null);
});

test('max spendable is total minus a sweep fee, and a max send goes through', () => {
  const utxos = [100_000_000n, 25_000_000n];
  const max = maxSpendableSoftwareSats(utxos, FEE_RATE);
  assert.equal(max, 125_000_000n - estimateTaprootFeeSats(2, 1, FEE_RATE));

  // The advertised MAX must be estimable (the pre-fix rate-as-buffer bug made it fail).
  const estimate = estimateSoftwareSendFee(utxos, max, FEE_RATE);
  assert.ok(estimate);
  assert.equal(estimate.totalDebitSats, 125_000_000n);

  assert.equal(maxSpendableSoftwareSats([], FEE_RATE), 0n);
  assert.equal(maxSpendableSoftwareSats([100n], FEE_RATE), 0n); // fee exceeds balance
});
