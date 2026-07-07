/**
 * Pure send-history record types and status derivation, dependency-free for
 * node --test coverage. Persistence lives in send-history.ts.
 */
import type { RecipientSendStatus } from '../../types/app-bridge';

export interface SendHistoryRecord {
  id: string;
  // Stored trimmed; matched normalized (trim + lowercase).
  recipientAddress: string;
  txid: string;
  // String, not bigint: the value crosses JSON and IPC boundaries.
  amountSats: string;
  network: 'mainnet' | 'testnet';
  source: 'software' | 'hardware';
  createdAt: number;
  confirmedAt?: number;
}

export function isSendHistoryRecord(value: unknown): value is SendHistoryRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Partial<SendHistoryRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.recipientAddress === 'string' &&
    typeof record.txid === 'string' &&
    typeof record.amountSats === 'string' &&
    (record.network === 'mainnet' || record.network === 'testnet') &&
    (record.source === 'software' || record.source === 'hardware') &&
    typeof record.createdAt === 'number'
  );
}

export function normalizeRecipientAddress(address: string): string {
  return address.trim().toLowerCase();
}

// Converts a PRL float (the software wallet RPC surface works in floats) to a
// sats string via fixed 8-decimal formatting, avoiding float multiplication.
export function pearlAmountToSatsString(value: number): string {
  const [whole, fraction = ''] = value.toFixed(8).split('.');
  return (BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8))).toString();
}

export function recordsForRecipient(
  records: SendHistoryRecord[],
  address: string,
  network: 'mainnet' | 'testnet'
): SendHistoryRecord[] {
  const normalized = normalizeRecipientAddress(address);
  return records.filter(
    record =>
      record.network === network &&
      normalizeRecipientAddress(record.recipientAddress) === normalized
  );
}

// Derives a recipient's send status from their history records plus any
// freshly looked-up confirmation counts (by txid). A record counts as
// confirmed when it has confirmedAt or its txid shows > 0 confirmations.
export function deriveRecipientStatus(
  records: SendHistoryRecord[],
  confirmationsByTxid: Map<string, number> = new Map()
): RecipientSendStatus {
  let hasConfirmedSend = false;
  let hasPendingSend = false;
  let lastSendAt: number | null = null;

  for (const record of records) {
    lastSendAt = Math.max(lastSendAt ?? 0, record.createdAt);

    const confirmed =
      record.confirmedAt !== undefined || (confirmationsByTxid.get(record.txid) ?? 0) > 0;
    if (confirmed) {
      hasConfirmedSend = true;
    } else {
      hasPendingSend = true;
    }
  }

  return {
    hasAnySend: records.length > 0,
    hasConfirmedSend,
    hasPendingSend,
    lastSendAt,
  };
}
