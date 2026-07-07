import type {RecipientSendStatus} from '../../types/app-bridge';
import type {Transaction} from '../../types/transaction';
import type {WalletService} from './wallet-service/wallet-service';
import {getRecordsForRecipient, markSendConfirmed} from '../config/send-history';
import {
  deriveRecipientStatus,
  normalizeRecipientAddress,
} from '../config/send-history-model';

/**
 * Returns whether (and how) this user has previously sent to a recipient.
 * Confirmed history records answer immediately; unconfirmed ones are lazily
 * refreshed via the local wallet's transaction list. A fresh chain host may
 * not know old txids until their address is backfilled — those records stay
 * unconfirmed, so the large-send gate fails closed and self-heals once the
 * backfill lands the transactions in the wallet's view.
 */
export async function getRecipientSendStatus(
  address: string,
  network: 'mainnet' | 'testnet',
  walletService: WalletService
): Promise<RecipientSendStatus> {
  const records = getRecordsForRecipient(address, network);

  const status = deriveRecipientStatus(records);
  if (status.hasConfirmedSend) {
    return status;
  }

  let walletTransactions: Transaction[] | null = null;
  try {
    walletTransactions = await walletService.listAllTransactions();
  } catch (error) {
    console.error('Failed to read wallet transactions for send history:', error);
  }

  const unconfirmed = records.filter(record => record.confirmedAt === undefined);
  const confirmationsByTxid = new Map<string, number>();

  if (unconfirmed.length > 0 && walletTransactions) {
    for (const tx of walletTransactions) {
      confirmationsByTxid.set(tx.txid, tx.confirmations);
    }

    for (const record of unconfirmed) {
      if ((confirmationsByTxid.get(record.txid) ?? 0) > 0) {
        try {
          markSendConfirmed(record.txid);
        } catch (error) {
          console.error('Failed to persist send confirmation:', error);
        }
      }
    }
  }

  const refreshed = deriveRecipientStatus(records, confirmationsByTxid);
  if (refreshed.hasConfirmedSend) {
    return refreshed;
  }

  // Fallback for sends made before send history existed: a confirmed 'sent'
  // transaction to this recipient in the wallet's own history also counts.
  if (walletTransactions) {
    const normalized = normalizeRecipientAddress(address);
    const hasConfirmedWalletSend = walletTransactions.some(
      tx =>
        tx.type === 'sent' &&
        tx.confirmations > 0 &&
        normalizeRecipientAddress(tx.address ?? '') === normalized
    );
    if (hasConfirmedWalletSend) {
      return {...refreshed, hasAnySend: true, hasConfirmedSend: true};
    }
  }

  return refreshed;
}
