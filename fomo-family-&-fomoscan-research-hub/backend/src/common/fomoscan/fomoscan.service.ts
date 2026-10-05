import { Injectable } from '@nestjs/common';

/**
 * FomoScan sponsor API (identity + PnL + leaderboard + thesis).
 * Base: https://api.fomoscan.sh — auth `Authorization: Bearer <FOMOSCAN_API_KEY>`.
 * Sponsor plan: 60 req/min — the client throttles to ≥1.1s between calls and
 * caches per endpoint TTL so background jobs never burn the quota.
 * tsx-safe: no-arg constructor (env) + configure() for tests.
 */
export const FOMOSCAN_BASE_URL = 'https://api.fomoscan.sh';

/** Minimum gap between outbound calls (60/min plan → 1.1s safety margin). */
export const FOMOSCAN_MIN_GAP_MS = 1100;

export type FomoscanFetch = (
  url: string,
  init?: { signal?: AbortSignal; method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const netFetch: FomoscanFetch = (url, init) =>
  fetch(
    url,
    init ? { signal: init.signal, method: init.method, headers: init.headers, body: init.body } : undefined,
  ) as Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FomoscanWindow {
  netUsd: number;
  returnPct: number;
  volumeUsd: number;
  trades: number;
  buys: number;
  sells: number;
  tokensTraded: number;
  winningTokens: number;
  rank: number | null;
  status: string;
  updatedAt: number;
}

export interface FomoscanPnl {
  handle: string;
  wallet: string;
  evmWallet: string | null;
  status: string;
  updatedAt: number;
  windows: Record<string, FomoscanWindow>;
}

export interface FomoscanIdentity {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  profilePicture: string | null;
  twitter: string | null;
  solanaAddress: string;
  evmAddress: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  username: string;
  isVerified: boolean;
  pnlSol: number;
  pnlUsd: number;
  pnlPercent: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
}

@Injectable()
export class FomoscanService {
  private base: string;
  private apiKey?: string;
  private lastCallAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, { at: number; data: unknown }>();

  constructor() {
    this.base = (process.env.FOMOSCAN_BASE_URL || FOMOSCAN_BASE_URL).replace(/\/$/, '');
    this.apiKey = process.env.FOMOSCAN_API_KEY || undefined;
  }

  configure(base?: string, apiKey?: string): this {
    if (base) this.base = base.replace(/\/$/, '');
    if (apiKey !== undefined) this.apiKey = apiKey || undefined;
    return this;
  }

  enabled(): boolean {
    return !!this.apiKey;
  }

  private requireKey(): string {
    if (!this.apiKey) throw new Error('FomoScan API key is not configured (FOMOSCAN_API_KEY).');
    return this.apiKey;
  }

  /** Serialize calls with a minimum gap (protects the 60/min sponsor quota). */
  private async gate(): Promise<void> {
    const run = this.queue.then(async () => {
      const wait = FOMOSCAN_MIN_GAP_MS - (Date.now() - this.lastCallAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCallAt = Date.now();
    });
    this.queue = run.catch(() => undefined);
    await run;
  }

  private async call<T>(
    method: string,
    path: string,
    body: unknown,
    cacheTtlMs: number,
    fetcher: FomoscanFetch = netFetch,
  ): Promise<T> {
    const key = this.requireKey();
    const cacheKey = `${method}:${path}:${body ? JSON.stringify(body) : ''}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < cacheTtlMs) return hit.data as T;
    await this.gate();
    const res = await fetcher(`${this.base}${path}`, {
      signal: AbortSignal.timeout(15000),
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`FomoScan ${res.status} for ${method} ${path.split('?')[0]}`);
    const data = (await res.json()) as T;
    this.cache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  async me(fetcher?: FomoscanFetch): Promise<unknown> {
    return this.call('GET', '/v2/me', undefined, 3600_000, fetcher);
  }

  /** Verified identity (solana + EVM + bio + avatar) for a FOMO handle. */
  async resolveHandle(handle: string, fetcher?: FomoscanFetch): Promise<FomoscanIdentity> {
    const clean = (handle ?? '').trim().replace(/^@/, '');
    if (!clean) throw new Error('Handle is required.');
    return this.call('GET', `/v2/user/handle/${encodeURIComponent(clean)}`, undefined, 3600_000, fetcher);
  }

  /** Who is behind this wallet? Returns the verified identity (or 404 shape). */
  async lookupWallet(address: string, fetcher?: FomoscanFetch): Promise<FomoscanIdentity> {
    const clean = (address ?? '').trim();
    if (!clean) throw new Error('Wallet address is required.');
    return this.call('GET', `/v2/user/wallet/${encodeURIComponent(clean)}`, undefined, 3600_000, fetcher);
  }

  /** Whole-wallet PnL windows for one handle. */
  async getPnl(handle: string, fetcher?: FomoscanFetch): Promise<FomoscanPnl> {
    const clean = (handle ?? '').trim().replace(/^@/, '');
    if (!clean) throw new Error('Handle is required.');
    return this.call('GET', `/v2/user/handle/${encodeURIComponent(clean)}/pnl`, undefined, 300_000, fetcher);
  }

  /** Whole-wallet PnL for up to 100 handles in ONE call (fast-path batch). */
  async batchPnl(handles: string[], fetcher?: FomoscanFetch): Promise<{ count: number; entries: FomoscanPnl[] }> {
    const clean = [...new Set(handles.map((h) => (h ?? '').trim().replace(/^@/, '')).filter(Boolean))];
    if (clean.length === 0) return { count: 0, entries: [] };
    if (clean.length > 100) throw new Error('batchPnl accepts at most 100 handles.');
    return this.call('POST', '/v2/user/handles/pnl', { handles: clean }, 300_000, fetcher);
  }

  /** Verified pump.fun PnL leaderboard (period: daily|weekly|monthly). */
  async leaderboard(
    limit = 25,
    period: 'daily' | 'weekly' | 'monthly' = 'weekly',
    fetcher?: FomoscanFetch,
  ): Promise<{ period?: string; entries: LeaderboardEntry[] }> {
    const n = Math.min(Math.max(limit | 0, 1), 100);
    const p = ['daily', 'weekly', 'monthly'].includes(period) ? period : 'weekly';
    return this.call('GET', `/v2/pump/leaderboard/traders?period=${p}&limit=${n}`, undefined, 600_000, fetcher);
  }

  /** Newest theses (P3 feed source; exposed here, not yet ingested). */
  async thesis(limit = 10, fetcher?: FomoscanFetch): Promise<unknown> {
    const n = Math.min(Math.max(limit | 0, 1), 50);
    return this.call('GET', `/v2/thesis?limit=${n}`, undefined, 120_000, fetcher);
  }
}
