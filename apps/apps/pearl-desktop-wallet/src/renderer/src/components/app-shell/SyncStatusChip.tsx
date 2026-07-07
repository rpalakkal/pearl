import {useWalletStore} from '../../store/walletStore';
import {useActiveAccount} from '../../store/accountsStore';

// Persistent header status: connecting / syncing % / synced-at-height.
// For hardware-only accounts the chain host starts lazily on the first
// balance read, so an honest "Connecting…" covers the gap.
export function SyncStatusChip() {
  const {syncPhase, headerHeight, blockHeight, bestPeerHeight, isBlockchainSynced} =
    useWalletStore();
  const active = useActiveAccount();

  let dotClass = 'bg-gray-400';
  let label = 'Connecting…';

  if (isBlockchainSynced) {
    dotClass = 'bg-green-500';
    label = `Synced · #${headerHeight.toLocaleString()}`;
  } else if (syncPhase === 'headers' || syncPhase === 'filters') {
    dotClass = 'bg-amber-500';
    label = `Syncing headers ${percent(headerHeight, bestPeerHeight)}%`;
  } else if (syncPhase === 'blocks') {
    dotClass = 'bg-amber-500';
    label = `Scanning blocks ${percent(blockHeight, headerHeight || bestPeerHeight)}%`;
  } else if (!active) {
    // No account yet — nothing meaningful to report.
    return null;
  }

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 shadow-sm sm:inline-flex"
      title="Chain sync status"
    >
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

function percent(current: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((current / total) * 100));
}
