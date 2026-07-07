import {useEffect, useRef, useState} from 'react';
import {hardwareAccountKey} from '../../pages/hardware-wallet/pageModel.ts';
import {getErrorMessage} from '../../lib/utils.ts';
import type {HardwareWalletAddress} from '../../lib/hardwareWallet.ts';
import type {Transaction} from '../../../../types/transaction.ts';

const PAGE_SIZE = 10;

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
  const [source, setSource] = useState<'indexer' | 'oyster' | null>(null);
  const [walletSyncing, setWalletSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setSource(null);
    setWalletSyncing(false);
    setError(null);
    pageRef.current = 1;
    if (account) {
      void loadPage(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  return {
    activities,
    loading,
    hasMore,
    source,
    walletSyncing,
    error,
    loadMore: () => {
      pageRef.current += 1;
      void loadPage(pageRef.current);
    },
  };
}
