import {ArrowLeft, RefreshCw, Search} from 'lucide-react';
import {Transaction} from '../../../types/transaction';
import {usePagination} from '../hooks/usePagination';
import {useHardwareActivity} from '../hooks/hardware/useHardwareActivity';
import {useAccountsStore, useActiveAccount} from '../store/accountsStore';
import {Button} from '@/components/ui/button';
import {ActivityRow, type ActivityAddressRole} from '../components/activity/ActivityRow';
import {
  groupActivities,
  matchesActivityFilter,
  type ActivityFilter,
} from '../components/activity/activityGroups';
import {AddressBookDialog} from '../components/contact-book/AddressBookDialog';
import {useAddressBook} from '../components/contact-book/useAddressBook';
import {useEffect, useMemo, useRef, useState} from 'react';

interface ActivityPageProps {
  onBack: () => void;
}

const FILTERS: Array<{value: ActivityFilter; label: string}> = [
  {value: 'all', label: 'All'},
  {value: 'sent', label: 'Sent'},
  {value: 'received', label: 'Received'},
];

export default function ActivityPage({onBack}: ActivityPageProps) {
  const active = useActiveAccount();
  const network = useAccountsStore(state => state.network);
  const isHardware = active?.kind === 'hardware';
  const software = usePagination({pageSize: 25, enabled: !isHardware, resetKey: active?.id ?? null});
  const hardware = useHardwareActivity(isHardware ? active : null);
  const {activities, loading, hasMore, loadMore} = isHardware ? hardware : software;
  const {resolveAddress} = useAddressBook();

  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');
  const [addContactAddress, setAddContactAddress] = useState<string | null>(null);

  const isFiltered = filter !== 'all' || query.trim() !== '';
  const filtered = useMemo(
    () => activities.filter((tx: Transaction) => matchesActivityFilter(tx, filter, query)),
    [activities, filter, query]
  );
  const groups = useMemo(() => groupActivities(filtered), [filtered]);

  // Infinite scroll: auto-load the next page when the sentinel at the list's
  // end scrolls into view — only while unfiltered, so a search doesn't
  // silently trawl the entire history. Load More stays as manual fallback.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const canAutoLoad = hasMore && !loading && !isFiltered;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !canAutoLoad) {
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        loadMoreRef.current();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canAutoLoad]);

  // Software received rows carry our own receiving address, not the sender.
  function addressRoleFor(tx: Transaction): ActivityAddressRole {
    return isHardware || tx.type === 'sent' ? 'counterparty' : 'own';
  }

  const totalLabel = isHardware
    ? hardware.total !== null
      ? `Showing ${activities.length} of ${hardware.total} transactions`
      : `${activities.length} transactions loaded${hasMore ? ' — more available' : ''}`
    : `${activities.length} transactions loaded${hasMore ? ' — more available' : ''}`;

  return (
    <div className="flex h-screen w-full flex-col bg-transparent">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
        <button onClick={onBack} className="rounded-lg p-2 transition-colors hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-700" />
        </button>
        <h1 className="flex-1 text-2xl font-semibold text-gray-900">Activity</h1>
        <button
          onClick={() => (isHardware ? hardware.refresh() : software.refresh())}
          disabled={loading}
          className="rounded-lg p-2 transition-colors hover:bg-gray-100 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 text-gray-700 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter / search sub-header */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-white/60 px-6 py-3">
        <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
          {FILTERS.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                filter === option.value
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search txid or address"
            className="focus:border-brand-green focus:ring-brand-green/20 w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2"
          />
        </div>
        {isFiltered && (
          <span className="text-xs text-gray-400">Search covers loaded transactions only.</span>
        )}
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-6">
        {isHardware && hardware.error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {hardware.error}
          </div>
        )}
        {isHardware && hardware.source === 'oyster' && !hardware.error && (
          <div className="mb-4 text-center text-xs text-gray-400">
            Showing the local wallet's view — the network indexer is unreachable.
            {hardware.walletSyncing && ' The wallet is still syncing; history may be incomplete.'}
          </div>
        )}
        {isHardware &&
          hardware.backfill &&
          (hardware.backfill.status === 'queued' || hardware.backfill.status === 'running') && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              A history backfill is in progress (
              {hardware.backfill.currentHeight.toLocaleString()} /{' '}
              {hardware.backfill.targetHeight.toLocaleString()}) — older transactions may be
              missing.
            </div>
          )}
        {loading && activities.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <p>Loading activities...</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <p>No activity found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">
                No matches in loaded transactions.
              </div>
            ) : (
              groups.map(group => (
                <div key={group.label}>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {group.label}
                  </div>
                  <div className="space-y-4">
                    {group.items.map((tx, index) => (
                      <ActivityRow
                        key={`${tx.type}_${tx.txid}_${index}`}
                        tx={tx}
                        network={network}
                        addressRole={addressRoleFor(tx)}
                        resolved={
                          addressRoleFor(tx) === 'counterparty'
                            ? resolveAddress(tx.address)
                            : null
                        }
                        onAddContact={setAddContactAddress}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}

            {/* Invisible sentinel: scrolling it into view auto-loads the next page. */}
            <div ref={sentinelRef} aria-hidden className="h-px" />

            {loading && activities.length > 0 && (
              <div className="py-2 text-center text-sm text-gray-500">Loading more...</div>
            )}

            {!hasMore && activities.length > 0 && (
              <div className="py-2 text-center text-xs text-gray-400">No more activity</div>
            )}

            {hasMore ? (
              <div className="flex justify-center pt-2">
                <Button
                  onClick={loadMore}
                  disabled={loading}
                  className="bg-brand-green hover:bg-brand-green/90 px-6 text-white"
                >
                  {loading ? 'Loading…' : 'Load More'}
                </Button>
              </div>
            ) : null}

            {/* Total count indicator */}
            <div className="mt-6 border-t border-gray-200 py-4 text-center text-sm text-gray-500">
              {totalLabel}
            </div>
          </div>
        )}
      </div>

      <AddressBookDialog
        isOpen={addContactAddress !== null}
        onClose={() => setAddContactAddress(null)}
        initialMode="add"
        initialAddress={addContactAddress ?? ''}
      />
    </div>
  );
}
