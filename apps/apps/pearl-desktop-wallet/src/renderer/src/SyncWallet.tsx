import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useWalletStore } from './store/walletStore';
import { useAccountsStore } from './store/accountsStore';
import { writeCachedBalance } from './lib/accountBalanceCache';

// Routes outside the app lock where no wallet polling should run. Everything
// else (including the hardware page) polls while a software wallet process is
// running — it keeps serving local reads even when a hardware account is the
// active one.
const LOCKED_ROUTES = ['/', '/unlock', '/setup', '/import-account', '/onboarding/create'];

function SyncWallet() {
  const { syncWalletData, updateSyncProgress, isBlockchainSynced, balance } = useWalletStore();
  const { pathname } = useLocation();
  // Cache the active software account's balance for the switcher. Lives here
  // (not in walletStore) because reading accountsStore from walletStore would
  // create a store import cycle.
  const activeAccountId = useAccountsStore(state => state.activeAccountId);
  const network = useAccountsStore(state => state.network);
  const activeIsSoftware = activeAccountId?.startsWith('software:') ?? false;

  useEffect(() => {
    if (typeof balance === 'number' && activeAccountId && activeIsSoftware) {
      writeCachedBalance(network, activeAccountId, balance);
    }
  }, [balance, activeAccountId, activeIsSoftware, network]);
  const dataIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isUnlocked = !LOCKED_ROUTES.includes(pathname);

  useEffect(() => {
    if (!isUnlocked) {
      if (dataIntervalRef.current) {
        clearInterval(dataIntervalRef.current);
        dataIntervalRef.current = null;
      }
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      return;
    }

    syncWalletData();
    updateSyncProgress();

    dataIntervalRef.current = setInterval(() => {
      syncWalletData();
    }, 10000);

    syncIntervalRef.current = setInterval(() => {
      updateSyncProgress();
    }, 5000);

    return () => {
      if (dataIntervalRef.current) {
        clearInterval(dataIntervalRef.current);
        dataIntervalRef.current = null;
      }
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [isUnlocked]);

  useEffect(() => {
    if (!isUnlocked) return;

    // Once synced, downshift to a slow heartbeat instead of stopping: the
    // header status chip keeps showing a live synced-at height.
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }
    if (isBlockchainSynced) {
      syncWalletData();
    } else {
      updateSyncProgress();
    }
    syncIntervalRef.current = setInterval(
      () => {
        updateSyncProgress();
      },
      isBlockchainSynced ? 60_000 : 5_000
    );
  }, [isBlockchainSynced, isUnlocked]);

  return null;
}

export { SyncWallet };
