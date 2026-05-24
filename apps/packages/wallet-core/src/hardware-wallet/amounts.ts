import {SATS_PER_PEARL} from './constants.ts';

export function parsePearlAmountToSats(amount: string): bigint {
  const normalized = amount.trim();

  if (!/^\d+(\.\d{0,8})?$/.test(normalized)) {
    throw new Error('Enter an amount with up to 8 decimal places.');
  }

  const [wholePart, fractionPart = ''] = normalized.split('.');
  const whole = BigInt(wholePart);
  const fraction = BigInt(fractionPart.padEnd(8, '0') || '0');
  const sats = whole * SATS_PER_PEARL + fraction;

  if (sats <= 0n) {
    throw new Error('Enter an amount greater than 0 PRL.');
  }

  return sats;
}

export function formatSatsAsPearl(value: string | number | bigint | undefined): string {
  if (value === undefined) {
    return '0 PRL';
  }

  try {
    const sats = BigInt(value);
    const negative = sats < 0n;
    const absoluteSats = negative ? -sats : sats;
    const whole = absoluteSats / SATS_PER_PEARL;
    const fraction = (absoluteSats % SATS_PER_PEARL).toString().padStart(8, '0').replace(/0+$/, '');
    const amount = fraction ? `${whole}.${fraction}` : whole.toString();
    return `${negative ? '-' : ''}${amount} PRL`;
  } catch {
    return `${Number(value) / Number(SATS_PER_PEARL)} PRL`;
  }
}

export function parseSatsValue(value: string | number, label: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer number of sats.`);
    }

    return BigInt(value);
  }

  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer number of sats.`);
  }

  return BigInt(normalized);
}

export function bigintToSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is too large to encode safely.`);
  }

  return Number(value);
}
