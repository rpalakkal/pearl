/**
 * Large-send test-transaction gate, shared by the software and hardware send
 * flows. A "large" send to a recipient the user has never successfully sent
 * to before is blocked until a small test transaction confirms; a confirmed
 * prior send to the address bypasses the gate.
 *
 * Pure bigint math so it runs under node --test and never touches floats.
 */

// 0.001 PRL — the suggested test transaction size.
export const TEST_SEND_AMOUNT_SATS = 100_000n;

// A send at or above this share of the spendable balance counts as large.
// Future configurability point: surface this in a settings file if users
// need to tune it.
export const LARGE_SEND_THRESHOLD_PERCENT = 25n;

export interface SendGateInput {
  amountSats: bigint;
  spendableBalanceSats: bigint;
  recipient: {
    hasConfirmedSend: boolean;
  };
}

export type SendGateDecision =
  | {blocked: false; isLargeSend: boolean}
  | {blocked: true; isLargeSend: true; suggestedTestAmountSats: bigint; reason: string};

// Plain decimal PRL string (no unit suffix), suitable for amount inputs.
export function satsToPearlInput(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const fraction = (sats % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function maxBigint(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function minBigint(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export function evaluateSendGate(input: SendGateInput): SendGateDecision {
  const {amountSats, spendableBalanceSats, recipient} = input;

  // Tiny amounts are never gated; otherwise the test send itself would be
  // blocked on small balances.
  if (amountSats <= TEST_SEND_AMOUNT_SATS) {
    return {blocked: false, isLargeSend: false};
  }

  const isLargeSend =
    spendableBalanceSats > 0n &&
    amountSats * 100n >= spendableBalanceSats * LARGE_SEND_THRESHOLD_PERCENT;

  if (!isLargeSend || recipient.hasConfirmedSend) {
    return {blocked: false, isLargeSend};
  }

  return {
    blocked: true,
    isLargeSend: true,
    suggestedTestAmountSats: maxBigint(
      1n,
      minBigint(TEST_SEND_AMOUNT_SATS, spendableBalanceSats / 10n)
    ),
    reason:
      'This is a large send to an address you have not sent to before. ' +
      'Send a small test amount first and wait for it to confirm.',
  };
}
