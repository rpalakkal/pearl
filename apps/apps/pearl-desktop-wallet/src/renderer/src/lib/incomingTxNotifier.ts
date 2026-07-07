import {toast} from '@/components/ui/use-toast';
import type {Transaction} from '../../../types/transaction';

export {diffNewReceivedTxs} from './incomingTxDiff';

export function notifyIncomingTransactions(txs: Transaction[]): void {
  if (txs.length === 0) {
    return;
  }

  const title = txs.length === 1 ? 'Payment received' : `${txs.length} payments received`;
  const total = txs.reduce((sum, tx) => sum + tx.amount, 0);
  const description = `+${total} PRL`;

  try {
    toast({title, description});
  } catch (error) {
    console.warn('Failed to show incoming payment toast:', error);
  }

  // HTML5 notifications work in the Electron renderer without extra IPC.
  try {
    if (typeof Notification !== 'undefined' && Notification.permission !== 'denied') {
      new Notification('Pearl Wallet', {body: `${title}: ${description}`});
    }
  } catch (error) {
    console.warn('Failed to show incoming payment notification:', error);
  }
}
