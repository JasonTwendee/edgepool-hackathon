import { useCallback, useEffect, useState } from 'react';

export interface MarketTick {
  id: string;
  label: string;
  glyph: string;
  priceUsd: number | null;
  changePct24h: number | null;
}

/** Last-known snapshot so the ticker never renders empty. */
const FALLBACK: MarketTick[] = [
  { id: 'bitcoin', label: 'BTC', glyph: '₿', priceUsd: 83280.61, changePct24h: -0.8 },
  { id: 'ethereum', label: 'ETH', glyph: 'Ξ', priceUsd: 2669.64, changePct24h: -1.56 },
  { id: 'solana', label: 'SOL', glyph: '◎', priceUsd: 118.46, changePct24h: -0.83 },
  { id: 'usd-coin', label: 'USDC', glyph: '$', priceUsd: 1.0, changePct24h: 0.0 },
];

/**
 * Majors ticker via the backend proxy (`GET /api/market/ticks`) — keys stay
 * server-side. Falls back to the last snapshot; `stale` flags quotes older
 * than 3 minutes or a failed fetch with no prior success.
 */
export function useMarketTicker(pollMs = 60000): { ticks: MarketTick[]; stale: boolean } {
  const [ticks, setTicks] = useState<MarketTick[]>(FALLBACK);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/market/ticks');
      if (!res.ok) throw new Error(`ticks ${res.status}`);
      const body = (await res.json()) as { success: boolean; stale?: boolean; data: MarketTick[] };
      if (!body.success || !Array.isArray(body.data) || body.data.length === 0) return;
      setTicks(body.data);
      if (!body.stale) setLastOk(Date.now());
    } catch {
      // keep last snapshot; stale flag below covers it
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (pollMs <= 0) return;
    const timer = setInterval(() => {
      void refresh();
      setNow(Date.now());
    }, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { ticks, stale: lastOk === null || now - lastOk > 180000 };
}
