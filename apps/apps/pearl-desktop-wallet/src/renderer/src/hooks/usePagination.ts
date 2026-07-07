import { useCallback, useEffect, useRef, useState } from 'react';
import { Transaction } from '../../../types/transaction';

interface UsePaginationOptions {
  pageSize?: number;
  // When false the hook stays idle (used while a hardware account is active
  // and the software transaction list is not the data source).
  enabled?: boolean;
  // Restarts from the first page when it changes (e.g. the active account
  // id), so a switch never shows the previous account's transactions.
  resetKey?: string | null;
}

interface UsePaginationResult {
  activities: Transaction[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

export function usePagination(options: UsePaginationOptions = {}): UsePaginationResult {
  const { pageSize = 20, enabled = true, resetKey = null } = options;

  const [activities, setActivities] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);
  // Mirrored in refs so loadMore stays identity-stable across renders and a
  // reset can invalidate in-flight responses (generation bump).
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const generationRef = useRef(0);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    const generation = generationRef.current;
    loadingRef.current = true;
    setLoading(true);

    try {
      const offset = offsetRef.current;
      const txs = await window.appBridge.wallet.listTransactions(pageSize, offset);
      if (generationRef.current !== generation) {
        return; // account switched mid-flight
      }
      setActivities(prev => {
        const existingTxids = new Set(prev.map(tx => tx.txid));
        const newTxs = txs.filter(tx => !existingTxids.has(tx.txid));
        return [...prev, ...newTxs];
      });
      offsetRef.current = offset + pageSize;
      if (txs.length < pageSize) {
        hasMoreRef.current = false;
        setHasMore(false);
      }
    } catch (err) {
      if (generationRef.current !== generation) {
        return;
      }
      console.error('Failed to load activities:', err);
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      if (generationRef.current === generation) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [pageSize]);

  useEffect(() => {
    generationRef.current += 1;
    offsetRef.current = 0;
    loadingRef.current = false;
    hasMoreRef.current = true;
    setActivities([]);
    setHasMore(true);
    setLoading(false);
    if (enabled) {
      void loadMore();
    }
  }, [enabled, resetKey, loadMore]);

  return { activities, loading, hasMore, loadMore };
}
