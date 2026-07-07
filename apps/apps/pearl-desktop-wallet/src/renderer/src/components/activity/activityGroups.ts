import type {Transaction} from '../../../../types/transaction';

export type ActivityFilter = 'all' | 'sent' | 'received';

export interface ActivityGroup {
  label: string;
  items: Transaction[];
}

export function matchesActivityFilter(
  tx: Transaction,
  filter: ActivityFilter,
  query: string
): boolean {
  if (filter !== 'all' && tx.type !== filter) {
    return false;
  }
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    tx.txid.toLowerCase().includes(needle) ||
    (tx.address ?? '').toLowerCase().includes(needle)
  );
}

// Groups an already-sorted (newest-first) list into labeled sections without
// reordering it: unconfirmed rows are inherently newest, so the "Pending"
// group naturally leads. Re-sorting across paginated loads would shuffle
// rows as pages arrive.
export function groupActivities(txs: Transaction[], now: number = Date.now()): ActivityGroup[] {
  const groups: ActivityGroup[] = [];

  for (const tx of txs) {
    const label = groupLabel(tx, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(tx);
    } else {
      groups.push({label, items: [tx]});
    }
  }

  return groups;
}

function groupLabel(tx: Transaction, now: number): string {
  if (tx.confirmations === 0) {
    return 'Pending';
  }

  const date = new Date(tx.time);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) {
    return 'Today';
  }
  if (isSameDay(date, yesterday)) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'});
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
