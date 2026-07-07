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

export function normalizeBlockbookTxid(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Blockbook returned invalid ${label}.`);
  }

  return normalized.toLowerCase();
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
