import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnChainTransactionEvent } from '../types/onchain';
import { getPortfolioTransactions, type SwapAction } from '../lib/api';

export interface PortfolioParams {
  walletAddress: string;
  page: number;
  pageSize: number;
  action?: SwapAction;
  days: number;
  /** Auto refetch cadence (ms). Default 30s so the ledger tracks the 20s BE sync. 0 = off. */
  pollMs?: number;
  /** When false, no fetch/poll runs (consumer uses another source). Default true. */
  enabled?: boolean;
  /** Hide dust rows without USD value. Default true. */
  hideZero?: boolean;
}

interface Snapshot {
  data: OnChainTransactionEvent[];
  total: number;
  totalPages: number;
  at: number;
}

/** In-memory SWR cache keyed by full query — revisiting a tab/page renders
 *  the last dataset instantly while a fresh fetch revalidates in background. */
const snapshotCache = new Map<string, Snapshot>();

/** Server-paginated ledger hook — 25 tx/page, filterable by action + day window. */
export function usePortfolio(params: PortfolioParams) {
  const { walletAddress, page, pageSize, action, days, pollMs = 180000, enabled = true, hideZero = true } = params;
  const [data, setData] = useState<OnChainTransactionEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Wall-clock ms of the last successful fetch (drives "Synced … ago" UI). */
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const key = `${walletAddress}|${page}|${pageSize}|${action ?? ''}|${days}|${hideZero ? 1 : 0}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const applySnapshot = useCallback((snap: Snapshot) => {
    setData(snap.data);
    setTotal(snap.total);
    setTotalPages(snap.totalPages);
    setUpdatedAt(snap.at);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return;
    const k = keyRef.current;
    // Stale-while-revalidate: paint cache instantly, then fetch fresh.
    // A new key with no cache clears first (no wrong-wallet flash).
    const cached = snapshotCache.get(k);
    if (cached) {
      applySnapshot(cached);
      setLoading(false);
    } else {
      setData([]);
      setTotal(0);
      setTotalPages(0);
      setUpdatedAt(null);
      setLoading(true);
    }
    setError(null);
    try {
      const [w, pg, ps, act, d, hz] = k.split('|');
      const res = await getPortfolioTransactions({
        wallet: w,
        page: Number(pg),
        pageSize: Number(ps),
        action: (act || undefined) as SwapAction | undefined,
        days: Number(d),
        hideZero: hz === '1',
      });
      const snap: Snapshot = {
        data: res.data,
        total: res.total,
        totalPages: res.totalPages,
        at: Date.now(),
      };
      snapshotCache.set(k, snap);
      // Drop if a newer query took over while we were in flight.
      if (keyRef.current === k) applySnapshot(snap);
    } catch (e) {
      if (keyRef.current === k) setError((e as Error).message);
    } finally {
      if (keyRef.current === k) setLoading(false);
    }
  }, [applySnapshot, walletAddress, page, pageSize, action, days, hideZero]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [refresh, enabled]);

  useEffect(() => {
    if (!enabled || !pollMs || pollMs <= 0) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs, enabled]);

  return { data, total, totalPages, loading, error, refresh, updatedAt };
}
