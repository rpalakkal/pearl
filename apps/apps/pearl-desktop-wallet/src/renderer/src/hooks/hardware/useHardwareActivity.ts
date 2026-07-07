import {useEffect, useRef, useState} from 'react';
import {hardwareAccountKey} from '../../pages/hardware-wallet/pageModel.ts';
import {getErrorMessage} from '../../lib/utils.ts';
import type {HardwareWalletAddress} from '../../lib/hardwareWallet.ts';
import type {AddressBackfillStatus} from '../../../../types/app-bridge.ts';
import type {Transaction} from '../../../../types/transaction.ts';

const PAGE_SIZE = 25;
const BACKFILL_POLL_MS = 5_000;

/**
 * Transaction history for a hardware account, served by the local wallet
 * (the running user wallet or the hidden chain host). Fails soft — an error
 * yields an "unavailable" message, never a crash.
 */
export function useHardwareActivity(account: HardwareWalletAddress | null) {
  const accountKey = account ? hardwareAccountKey(account) : null;
  const requestKeyRef = useRef<string | null>(accountKey);
  requestKeyRef.current = accountKey;

  const [activities, setActivities] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [source, setSource] = useState<'indexer' | 'oyster' | null>(null);
  const [walletSyncing, setWalletSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In-flight address backfill (rescan) — history may be incomplete while
  // one runs. null when none exists or the wallet is unreachable.
  const [backfill, setBackfill] = useState<AddressBackfillStatus | null>(null);
  const pageRef = useRef(1);

  async function loadPage(page: number) {
    if (!account) {
      return;
    }
    const key = hardwareAccountKey(account);
    setLoading(true);

    try {
      const result = await window.appBridge.hardwareWallet.getTransactions({
        address: account.address,
        publicKey: account.publicKey,
        network: account.network,
        page,
        pageSize: PAGE_SIZE,
      });

      if (requestKeyRef.current !== key) {
        return; // account switched mid-flight
      }

      setActivities(prev => (page === 1 ? result.transactions : [...prev, ...result.transactions]));
      setHasMore(result.hasMore);
      setTotal(result.total);
      setSource(result.source);
      setWalletSyncing(result.walletSyncing);
      setError(null);
    } catch (err) {
      if (requestKeyRef.current !== key) {
        return;
      }
      console.error('Failed to load hardware account activity:', err);
      setError(getErrorMessage(err, 'Transaction history is unavailable right now.'));
      setHasMore(false);
    } finally {
      if (requestKeyRef.current === key) {
        setLoading(false);
      }
    }
  }

  // History is indexer-first, so loads don't touch the local wallet's locks
  // and can fire regardless of the wallet's sync phase.
  useEffect(() => {
    setActivities([]);
    setHasMore(false);
    setTotal(null);
    setSource(null);
    setWalletSyncing(false);
    setError(null);
    pageRef.current = 1;
    if (account) {
      void loadPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  // Surface an in-flight backfill so the page can warn that older history
  // may still be missing. getRescanStatus throws when no job exists or no
  // wallet runs — treated as "no backfill", never an error.
  useEffect(() => {
    setBackfill(null);
    if (!account) {
      return;
    }

    const address = account.address;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      let status: AddressBackfillStatus | null = null;
      try {
        status = await window.appBridge.wallet.getRescanStatus(address);
      } catch {
        status = null;
      }
      if (cancelled) {
        return;
      }
      setBackfill(status);
      if (status && (status.status === 'queued' || status.status === 'running')) {
        timer = setTimeout(() => void poll(), BACKFILL_POLL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  return {
    activities,
    loading,
    hasMore,
    total,
    source,
    walletSyncing,
    error,
    backfill,
    loadMore: () => {
      pageRef.current += 1;
      void loadPage(pageRef.current);
    },
    refresh: () => {
      pageRef.current = 1;
      void loadPage(1); // page 1 replaces the list
    },
  };
}
