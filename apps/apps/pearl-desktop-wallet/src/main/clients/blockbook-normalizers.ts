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

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Blockbook returned invalid ${label}.`);
  }

  return value as Record<string, unknown>;
}

// ---- Address transaction history (details=txs) ----

export interface BlockbookAddressHistory {
  transactions: import('../../types/transaction').Transaction[];
  hasMore: boolean;
  // Total transaction count for the address per the indexer; null when the
  // response omits it.
  total: number | null;
}

interface RawBlockbookVinVout {
  addresses?: unknown;
  value?: unknown;
}

function entryAddresses(entry: RawBlockbookVinVout): string[] {
  if (!Array.isArray(entry.addresses)) {
    return [];
  }
  return entry.addresses.filter((a): a is string => typeof a === 'string');
}

function entryValueSats(entry: RawBlockbookVinVout): bigint {
  if (typeof entry.value !== 'string' || !/^\d+$/.test(entry.value)) {
    return 0n;
  }
  return BigInt(entry.value);
}

function satsToPearlNumber(sats: bigint): number {
  return Number(sats) / 100_000_000;
}

// Normalizes one raw Blockbook transaction into the app's Transaction shape.
// Returns null for malformed entries instead of failing the whole list: a
// partially rendered history beats a crashed page.
function normalizeBlockbookHistoryTransaction(
  value: unknown,
  ourAddressLower: string,
  ourAddress: string
): import('../../types/transaction').Transaction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as {
    txid?: unknown;
    vin?: unknown;
    vout?: unknown;
    blockHash?: unknown;
    confirmations?: unknown;
    blockTime?: unknown;
    fees?: unknown;
  };

  let txid: string;
  try {
    txid = normalizeBlockbookTxid(raw.txid, 'history transaction id');
  } catch {
    return null;
  }

  const vins = Array.isArray(raw.vin) ? (raw.vin as RawBlockbookVinVout[]) : [];
  const vouts = Array.isArray(raw.vout) ? (raw.vout as RawBlockbookVinVout[]) : [];

  const isOurs = (entry: RawBlockbookVinVout) =>
    entryAddresses(entry).some(address => address.toLowerCase() === ourAddressLower);

  const sent = vins.some(isOurs);

  const feeSats =
    sent && typeof raw.fees === 'string' && /^\d+$/.test(raw.fees) ? BigInt(raw.fees) : 0n;

  let amountSats = 0n;
  let counterparty = ourAddress;
  let selfTransfer = false;
  if (sent) {
    for (const vout of vouts) {
      if (!isOurs(vout)) {
        amountSats += entryValueSats(vout);
        if (counterparty === ourAddress) {
          counterparty = entryAddresses(vout)[0] ?? ourAddress;
        }
      }
    }
    if (amountSats === 0n) {
      // Self-transfer: every output returned to us, so nothing actually
      // left the account. Report the net cost (the fee), not the recycled
      // balance — showing the full amount reads as funds leaving.
      selfTransfer = true;
      amountSats = feeSats;
    }
  } else {
    for (const vout of vouts) {
      if (isOurs(vout)) {
        amountSats += entryValueSats(vout);
      }
    }
  }

  const blockTime =
    typeof raw.blockTime === 'number' && Number.isFinite(raw.blockTime) ? raw.blockTime : null;

  return {
    txid,
    type: sent ? 'sent' : 'received',
    amount: satsToPearlNumber(amountSats),
    fee: satsToPearlNumber(feeSats),
    selfTransfer,
    confirmations:
      typeof raw.confirmations === 'number' && Number.isSafeInteger(raw.confirmations)
        ? raw.confirmations
        : 0,
    // Milliseconds, matching the Oyster transaction formatter; mempool
    // entries have no blockTime yet.
    time: blockTime !== null ? blockTime * 1000 : Date.now(),
    address: counterparty,
    account: '',
    blockhash: typeof raw.blockHash === 'string' ? raw.blockHash : '',
    trusted: false,
    generated: false,
  };
}

export function normalizeBlockbookAddressTransactions(
  value: unknown,
  address: string
): BlockbookAddressHistory {
  const record = assertRecord(value, 'address history');
  const page = typeof record.page === 'number' ? record.page : 1;
  const totalPages = typeof record.totalPages === 'number' ? record.totalPages : 1;
  const rawTransactions = Array.isArray(record.transactions) ? record.transactions : [];

  const ourAddressLower = address.trim().toLowerCase();
  const transactions = rawTransactions
    .map(raw => normalizeBlockbookHistoryTransaction(raw, ourAddressLower, address))
    .filter((tx): tx is NonNullable<typeof tx> => tx !== null);

  return {
    transactions,
    hasMore: page < totalPages,
    total: typeof record.txs === 'number' ? record.txs : null,
  };
}
