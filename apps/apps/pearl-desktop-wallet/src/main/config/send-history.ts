/**
 * Send-history persistence - records every broadcast send so the large-send
 * gate can tell whether a recipient has previously received a confirmed
 * transaction from this user.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import {
  isSendHistoryRecord,
  recordsForRecipient,
  type SendHistoryRecord,
} from './send-history-model';

const SETTINGS_DIR = path.join(os.homedir(), '.pearl-wallet', 'settings');
const SEND_HISTORY_FILE = path.join(SETTINGS_DIR, 'send-history.json');

// Keeps the file bounded; oldest records are dropped first.
const MAX_SEND_HISTORY_RECORDS = 500;

function ensureSettingsDir() {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

export function listSendHistory(): SendHistoryRecord[] {
  ensureSettingsDir();

  if (fs.existsSync(SEND_HISTORY_FILE)) {
    try {
      const data = fs.readFileSync(SEND_HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter(isSendHistoryRecord);
      }
    } catch (error) {
      console.error('Failed to load send history:', error);
    }
  }

  return [];
}

function saveSendHistory(records: SendHistoryRecord[]) {
  ensureSettingsDir();

  const bounded = records
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_SEND_HISTORY_RECORDS);

  try {
    fs.writeFileSync(SEND_HISTORY_FILE, JSON.stringify(bounded, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save send history:', error);
    throw new Error('Failed to save send history');
  }
}

export function recordSend(entry: {
  recipientAddress: string;
  txid: string;
  amountSats: string;
  network: 'mainnet' | 'testnet';
  source: 'software' | 'hardware';
}): SendHistoryRecord {
  const record: SendHistoryRecord = {
    id: randomUUID(),
    recipientAddress: entry.recipientAddress.trim(),
    txid: entry.txid,
    amountSats: entry.amountSats,
    network: entry.network,
    source: entry.source,
    createdAt: Date.now(),
  };

  const records = listSendHistory();
  records.push(record);
  saveSendHistory(records);
  return record;
}

export function markSendConfirmed(txid: string, confirmedAt: number = Date.now()) {
  const records = listSendHistory();
  let changed = false;

  for (const record of records) {
    if (record.txid === txid && record.confirmedAt === undefined) {
      record.confirmedAt = confirmedAt;
      changed = true;
    }
  }

  if (changed) {
    saveSendHistory(records);
  }
}

export function getRecordsForRecipient(
  address: string,
  network: 'mainnet' | 'testnet'
): SendHistoryRecord[] {
  return recordsForRecipient(listSendHistory(), address, network);
}
