import {estimateTaprootFeeSats, SATS_PER_PEARL, TAPROOT_DUST_SATS} from './hardwareWallet.ts';
import type {WalletUnspentOutput} from '../../../types/app-bridge.ts';

export interface SoftwareSendEstimate {
  feeSats: bigint;
  inputCount: number;
  totalDebitSats: bigint;
}

// The Go wallet does its own coin selection at broadcast time, so everything
// here is an estimate: it mirrors the wallet's shape (largest-first, taproot
// inputs/outputs, dust-aware change) closely enough to show a realistic fee
// and a MAX amount that actually goes through.

export function spendableUtxoSats(utxos: WalletUnspentOutput[]): bigint[] {
  return utxos
    .filter(utxo => utxo.spendable && utxo.confirmations >= 1 && utxo.amount > 0)
    .map(utxo => prlToSats(utxo.amount))
    .filter(sats => sats > 0n)
    .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
}

export function estimateSoftwareSendFee(
  utxoValuesSats: bigint[],
  amountSats: bigint,
  feeRatePrlPerKb: number
): SoftwareSendEstimate | null {
  if (amountSats <= 0n || !Number.isFinite(feeRatePrlPerKb) || feeRatePrlPerKb <= 0) {
    return null;
  }

  const sorted = [...utxoValuesSats].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
  let selectedValue = 0n;

  for (let inputCount = 1; inputCount <= sorted.length; inputCount += 1) {
    selectedValue += sorted[inputCount - 1];

    const noChangeFee = estimateTaprootFeeSats(inputCount, 1, feeRatePrlPerKb);

    if (selectedValue < amountSats + noChangeFee) {
      continue;
    }

    const withChangeFee = estimateTaprootFeeSats(inputCount, 2, feeRatePrlPerKb);
    const changeAfterChangeOutput = selectedValue - amountSats - withChangeFee;
    const feeSats =
      changeAfterChangeOutput >= TAPROOT_DUST_SATS ? withChangeFee : selectedValue - amountSats;

    return {feeSats, inputCount, totalDebitSats: amountSats + feeSats};
  }

  return null; // insufficient funds for amount + fee
}

// Upper bound on one send: all spendable UTXOs in, one output, no change.
export function maxSpendableSoftwareSats(
  utxoValuesSats: bigint[],
  feeRatePrlPerKb: number
): bigint {
  if (utxoValuesSats.length === 0 || !Number.isFinite(feeRatePrlPerKb) || feeRatePrlPerKb <= 0) {
    return 0n;
  }

  const totalSats = utxoValuesSats.reduce((total, sats) => total + sats, 0n);
  const feeSats = estimateTaprootFeeSats(utxoValuesSats.length, 1, feeRatePrlPerKb);
  return totalSats > feeSats ? totalSats - feeSats : 0n;
}

// listunspent reports amounts as floating-point PRL; round at the sat
// boundary to avoid float-tail drift.
export function prlToSats(amountPrl: number): bigint {
  if (!Number.isFinite(amountPrl) || amountPrl <= 0) {
    return 0n;
  }
  return BigInt(Math.round(amountPrl * Number(SATS_PER_PEARL)));
}
