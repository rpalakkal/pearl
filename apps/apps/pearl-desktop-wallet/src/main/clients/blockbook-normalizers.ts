export interface BlockbookAddressInfo {
  address: string;
  balance: string;
  totalReceived: string;
  totalSent: string;
  unconfirmedBalance: string;
  unconfirmedTxs: number;
  txs: number;
}

export interface BlockbookUtxo {
  txid: string;
  vout: number;
  value: string;
  height?: number;
  confirmations?: number;
}

export type BlockbookNetwork = 'mainnet' | 'testnet';

const BlockbookBaseUrlMap: Record<BlockbookNetwork, string> = {
  testnet: 'https://blockbook.testnet.pearlresearch.ai',
  mainnet: 'https://blockbook.pearlresearch.ai',
};

const MAX_ADDRESS_LENGTH = 120;
const MAX_FEE_TARGET_BLOCKS = 1008;

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Blockbook returned invalid ${label}.`);
  }

  return value as Record<string, unknown>;
}

export function normalizeBlockbookAddress(address: string): string {
  const normalized = address.trim();

  if (!normalized || normalized.length > MAX_ADDRESS_LENGTH) {
    throw new Error('Invalid Blockbook address request.');
  }

  return normalized;
}

export function normalizeBlockbookNetwork(network: unknown): BlockbookNetwork {
  if (network === undefined || network === null) {
    return 'mainnet';
  }

  if (network === 'mainnet' || network === 'testnet') {
    return network;
  }

  throw new Error('Invalid Blockbook network request.');
}

export function getBlockbookBaseUrl(network: unknown): string {
  return BlockbookBaseUrlMap[normalizeBlockbookNetwork(network)];
}

function normalizeSats(value: unknown, label: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Blockbook returned invalid ${label}.`);
    }

    return value.toString();
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return value;
  }

  throw new Error(`Blockbook returned invalid ${label}.`);
}

function normalizeSignedSats(value: unknown, label: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Blockbook returned invalid ${label}.`);
    }

    return value.toString();
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return value;
  }

  throw new Error(`Blockbook returned invalid ${label}.`);
}

function normalizeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Blockbook returned invalid ${label}.`);
  }

  return Number(value);
}

function normalizeOptionalSafeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeSafeInteger(value, label);
}

export function normalizeBlockbookTxid(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Blockbook returned invalid ${label}.`);
  }

  return normalized.toLowerCase();
}

export function normalizeBlockbookTransactionConfirmations(
  value: unknown,
  requestedTxid: string
): number {
  const record = assertRecord(value, 'transaction');
  const txid = normalizeBlockbookTxid(record.txid, 'transaction id');

  if (txid !== requestedTxid) {
    throw new Error('Blockbook returned transaction info for a different txid.');
  }

  return normalizeSafeInteger(record.confirmations, 'transaction confirmation count');
}

export function normalizeBlockbookAddressInfo(
  value: unknown,
  requestedAddress: string
): BlockbookAddressInfo {
  const record = assertRecord(value, 'address info');

  if (record.address !== requestedAddress) {
    throw new Error('Blockbook returned address info for a different address.');
  }

  return {
    address: requestedAddress,
    balance: normalizeSats(record.balance, 'address balance'),
    totalReceived: normalizeSats(record.totalReceived, 'total received amount'),
    totalSent: normalizeSats(record.totalSent, 'total sent amount'),
    unconfirmedBalance: normalizeSignedSats(record.unconfirmedBalance, 'unconfirmed balance'),
    unconfirmedTxs: normalizeSafeInteger(record.unconfirmedTxs, 'unconfirmed transaction count'),
    txs: normalizeSafeInteger(record.txs, 'transaction count'),
  };
}

function normalizeBlockbookUtxo(value: unknown): BlockbookUtxo {
  const record = assertRecord(value, 'UTXO');

  return {
    txid: normalizeBlockbookTxid(record.txid, 'UTXO transaction id'),
    vout: normalizeSafeInteger(record.vout, 'UTXO output index'),
    value: normalizeSats(record.value, 'UTXO value'),
    height: normalizeOptionalSafeInteger(record.height, 'UTXO height'),
    confirmations: normalizeOptionalSafeInteger(record.confirmations, 'UTXO confirmation count'),
  };
}

export function normalizeBlockbookUtxoList(value: unknown): BlockbookUtxo[] {
  if (!Array.isArray(value)) {
    throw new Error('Blockbook returned invalid UTXO list.');
  }

  return value.map(normalizeBlockbookUtxo);
}

export function normalizeBlockbookFeeTarget(numBlocks: number): number {
  if (!Number.isSafeInteger(numBlocks) || numBlocks < 1 || numBlocks > MAX_FEE_TARGET_BLOCKS) {
    throw new Error('Invalid Blockbook fee target.');
  }

  return numBlocks;
}

export function normalizeBlockbookFeeRate(value: unknown): number {
  const feeRate = Number(value);

  if (!Number.isFinite(feeRate) || feeRate <= 0) {
    throw new Error(`Blockbook returned an invalid fee estimate: ${String(value)}`);
  }

  return feeRate;
}

export function normalizeRawTransactionHex(rawTransactionHex: string): string {
  const normalized = rawTransactionHex.trim();

  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Invalid transaction hex.');
  }

  return normalized;
}
