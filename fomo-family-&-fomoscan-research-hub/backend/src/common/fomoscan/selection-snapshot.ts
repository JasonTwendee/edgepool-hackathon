import { createHash } from 'node:crypto';
import type { FomoscanPnl, LeaderboardEntry } from './fomoscan.service.js';

export interface SelectionWindowMetric {
  netUsd: number | null;
  returnPct: number | null;
  volumeUsd: number | null;
  trades: number | null;
  buys: number | null;
  sells: number | null;
  tokensTraded: number | null;
  winningTokens: number | null;
  winRatePct: number | null;
  rank: number | null;
  status: string | null;
  updatedAt: number | null;
}

export interface SelectionSnapshot {
  source: 'fomoscan';
  fetchedAt: string;
  period: string;
  wallet: string;
  handle: string;
  rank: number | null;
  ranks: { h24: number | null; d7: number | null; d30: number | null };
  whyTop: {
    pnlUsd: number | null;
    pnlPercent: number | null;
    realizedPnlUsd: number | null;
    unrealizedPnlUsd: number | null;
    primaryWindow: string | null;
    primary: SelectionWindowMetric | null;
  };
  windows: Record<string, SelectionWindowMetric>;
  raw: { entry: LeaderboardEntry; pnl: FomoscanPnl | null };
}

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function windowMetric(w: unknown): SelectionWindowMetric | null {
  if (!w || typeof w !== 'object') return null;
  const row = w as Record<string, unknown>;
  const tokens = numOrNull(row.tokensTraded);
  const winning = numOrNull(row.winningTokens);
  return {
    netUsd: numOrNull(row.netUsd),
    returnPct: numOrNull(row.returnPct),
    volumeUsd: numOrNull(row.volumeUsd),
    trades: numOrNull(row.trades),
    buys: numOrNull(row.buys),
    sells: numOrNull(row.sells),
    tokensTraded: tokens,
    winningTokens: winning,
    winRatePct: tokens && tokens > 0 && winning !== null ? (winning / tokens) * 100 : null,
    rank: numOrNull(row.rank),
    status: typeof row.status === 'string' ? row.status : null,
    updatedAt: numOrNull(row.updatedAt),
  };
}

/**
 * Build the immutable “why top” snapshot persisted on VaultTrader.entrySnapshot.
 * Fomo is the source of these metrics; local execution never invents them.
 */
export function buildSelectionSnapshot(
  entry: LeaderboardEntry,
  pnl: FomoscanPnl | null,
  period: string,
  fetchedAt = new Date(),
): SelectionSnapshot {
  const rawWindows = (pnl?.windows ?? {}) as Record<string, unknown>;
  const windows: Record<string, SelectionWindowMetric> = {};
  for (const [key, value] of Object.entries(rawWindows)) {
    const metric = windowMetric(value);
    if (metric) windows[key] = metric;
  }
  const pickWindow = (key: string): SelectionWindowMetric | null => windows[key] ?? null;
  const h24 = pickWindow('24h')?.rank ?? (period === 'daily' ? entry.rank : null);
  const d7 = pickWindow('7d')?.rank ?? (period === 'weekly' ? entry.rank : null);
  const d30 = pickWindow('30d')?.rank ?? (period === 'monthly' ? entry.rank : null);
  const primaryKey =
    period === 'daily' ? '24h' : period === 'monthly' ? '30d' : '7d';
  const primary = pickWindow(primaryKey) ?? null;
  const hasPrimary =
    primary !== null &&
    primary.status !== 'pending' &&
    primary.status !== 'unavailable' &&
    [primary.netUsd, primary.trades, primary.volumeUsd, primary.tokensTraded].some(
      (value) => value !== null,
    );

  return {
    source: 'fomoscan',
    fetchedAt: fetchedAt.toISOString(),
    period,
    wallet: entry.wallet,
    handle: entry.username,
    rank: numOrNull(entry.rank),
    ranks: { h24, d7, d30 },
    whyTop: {
      pnlUsd: numOrNull(entry.pnlUsd),
      pnlPercent: numOrNull(entry.pnlPercent),
      realizedPnlUsd: numOrNull(entry.realizedPnlUsd),
      unrealizedPnlUsd: numOrNull(entry.unrealizedPnlUsd),
      primaryWindow: hasPrimary ? primaryKey : null,
      primary: hasPrimary ? primary : null,
    },
    windows,
    raw: { entry, pnl },
  };
}

/** Stable hash for audit/evidence (not a security primitive). */
export function hashSelectionSnapshot(snapshot: SelectionSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
