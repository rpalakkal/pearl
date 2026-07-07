import {ArrowLeft, ArrowUpRight, ArrowDownLeft, Copy, Check} from 'lucide-react';
import {Transaction} from '../../../types/transaction';
import {usePagination} from '../hooks/usePagination';
import {useHardwareActivity} from '../hooks/hardware/useHardwareActivity';
import {useActiveAccount} from '../store/accountsStore';
import {Button} from '@/components/ui/button';
import {useEffect, useRef, useState} from 'react';

interface ActivityPageProps {
  onBack: () => void;
}

const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else {
    return `${days}d ago`;
  }
};

const formatFullDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

const truncateTxId = (txid: string): string => {
  if (txid.length <= 16) return txid;
  return `${txid.slice(0, 8)}...${txid.slice(-8)}`;
};

export default function ActivityPage({onBack}: ActivityPageProps) {
  const active = useActiveAccount();
  const isHardware = active?.kind === 'hardware';
  const software = usePagination({pageSize: 25, enabled: !isHardware});
  const hardware = useHardwareActivity(isHardware ? active : null);
  const {activities, loading, hasMore, loadMore} = isHardware ? hardware : software;
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);

  // Infinite scroll: auto-load the next page when the sentinel at the list's
  // end scrolls into view. The Load More button stays as a manual fallback.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const canAutoLoad = hasMore && !loading;

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

  const handleCopyTxId = async (txid: string) => {
    try {
      await navigator.clipboard.writeText(txid);
      setCopiedTxId(txid);
      setTimeout(() => setCopiedTxId(null), 2000);
    } catch (err) {
      console.error('Failed to copy transaction ID:', err);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-transparent">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
        <button onClick={onBack} className="rounded-lg p-2 transition-colors hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-700" />
        </button>
        <h1 className="text-2xl font-semibold text-gray-900">Activity</h1>
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
        {loading && activities.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <p>Loading activities...</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            <p>No activity found</p>
          </div>
        ) : (
          /* Activity List - Scrollable */
          <div className="space-y-4">
            {activities.map((activity: Transaction, index) => (
              <div
                key={`${activity.type}_${activity.txid}_${index}`}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                      {activity.type === 'received' ? (
                        <ArrowDownLeft className="text-brand-green h-6 w-6" />
                      ) : (
                        <ArrowUpRight className="h-6 w-6 text-red-500" />
                      )}
                    </div>
                    <div>
                      <div className="text-lg font-medium text-gray-900">
                        {activity.selfTransfer
                          ? 'Sent to self'
                          : activity.type === 'received'
                            ? 'Received'
                            : 'Sent'}
                      </div>
                      <div className="text-sm text-gray-600">
                        {formatTimeAgo(activity.time)} • {formatFullDate(activity.time)}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          Tx ID: {truncateTxId(activity.txid)}
                        </span>
                        <button
                          onClick={() => handleCopyTxId(activity.txid)}
                          className="rounded p-1 transition-colors hover:bg-gray-100"
                          title="Copy transaction ID"
                        >
                          {copiedTxId === activity.txid ? (
                            <Check className="text-brand-green h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3 text-gray-400" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-lg font-bold ${
                        activity.type === 'received' ? 'text-green-700' : 'text-red-500'
                      }`}
                    >
                      {activity.type === 'received' ? '+' : '-'}
                      {activity.amount} PRL
                    </div>
                    <div className="text-sm text-gray-600">
                      {activity.confirmations} confirmations
                    </div>
                    {activity.fee > 0 && (
                      <div className="text-xs text-gray-500">
                        Fee: {activity.fee.toFixed(8)} PRL
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

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
              {activities.length} transactions loaded
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
