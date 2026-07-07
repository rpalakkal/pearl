import type {Transaction} from '../../../types/transaction';

// Returns the newly seen incoming transactions. A null prev set means "first
// poll after (re)start" — it only seeds, never notifies, so unlocking or
// switching accounts doesn't replay old history as fresh payments.
export function diffNewReceivedTxs(
  prev: Set<string> | null,
  txs: Transaction[]
): Transaction[] {
  if (prev === null) {
    return [];
  }
  return txs.filter(
    tx => tx.type === 'received' && !tx.selfTransfer && !prev.has(tx.txid)
  );
}
