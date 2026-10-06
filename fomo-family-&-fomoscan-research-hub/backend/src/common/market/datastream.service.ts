import { Injectable } from '@nestjs/common';

/**
 * FluxBeam DataStream client (prices + candles). No key required for these
 * endpoints today; DATASTREAM_API_KEY is attached when present (header +
 * query variants attempted once each on 401).
 */
export const DATASTREAM_BASE_URL = 'https://data.fluxbeam.xyz';

/** Server TTL caches (G1 resource audit 2026-10-06): every page view fans out
 * several price/candle calls with zero cache. Env-overridable, 0 = disabled. */
export const PRICES_TTL_MS =
  process.env.DATASTREAM_PRICES_TTL_MS !== undefined ? Number(process.env.DATASTREAM_PRICES_TTL_MS) : 45000;
export const CANDLES_TTL_MS =
  process.env.DATASTREAM_CANDLES_TTL_MS !== undefined ? Number(process.env.DATASTREAM_CANDLES_TTL_MS) : 120000;

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const netFetch: FetchLike = (url, init) =>
  fetch(url, { signal: init?.signal }) as Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

@Injectable()
export class DataStreamService {
  private base: string;
  private apiKey?: string;
  /** Default fetch impl (G1 test seam: override in asserts to avoid network). */
  public defaultFetch: FetchLike = netFetch;
  // TTL cache + single-flight dedupe (G1): concurrent identical calls share
  // one fetch; fresh results are reused until TTL. Bypassed whenever a caller
  // passes an explicit fetcher (test seam / forced refresh).
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  // NOTE: no-arg constructor (tsx-safe DI). Use configure() in tests.
  constructor() {
    this.base = (process.env.DATASTREAM_BASE_URL || DATASTREAM_BASE_URL).replace(/\/$/, '');
    this.apiKey = process.env.DATASTREAM_API_KEY || undefined;
  }

  /** Test seam: drop all cached entries. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * TTL read-through + single-flight: concurrent callers with the same key
   * share one in-flight fetch; settled results are reused until `ttlMs`.
   * Failures are never cached (a 429 must not poison the window).
   */
  private async cached(key: string, ttlMs: number, run: () => Promise<unknown>): Promise<unknown> {
    if (!(ttlMs > 0)) return run();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    const ongoing = this.inflight.get(key);
    if (ongoing) return ongoing;
    const p = run().then(
      (data) => {
        this.inflight.delete(key);
        this.cache.set(key, { at: Date.now(), data });
        return data;
      },
      (err) => {
        this.inflight.delete(key);
        throw err;
      },
    );
    this.inflight.set(key, p);
    return p;
  }

  configure(base?: string, apiKey?: string): this {
    if (base) this.base = base.replace(/\/$/, '');
    if (apiKey !== undefined) this.apiKey = apiKey || undefined;
    return this;
  }

  private async get<T>(path: string, fetcher?: FetchLike): Promise<T> {
    const impl = fetcher ?? this.defaultFetch;
    // v1: plain GET (open endpoints). Key attached as query when present.
    const sep = path.includes('?') ? '&' : '?';
    const url = this.apiKey ? `${this.base}${path}${sep}key=${this.apiKey}` : `${this.base}${path}`;
    const res = await impl(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`DataStream ${res.status} for ${path.split('?')[0]}`);
    return (await res.json()) as T;
  }

  /** Mint → USD (bulk, max 255). Returns only mints the API priced. */
  async bulkPrices(mints: string[], fetcher?: FetchLike): Promise<Record<string, number>> {
    if (mints.length === 0) return {};
    const key = `prices:${[...new Set(mints)].sort().join(',')}`;
    const run = async (): Promise<Record<string, number>> => {
      const body = await this.get<{ data?: Record<string, number> }>(
        `/prices?ids=${mints.map(encodeURIComponent).join(',')}`,
        fetcher,
      );
      const out: Record<string, number> = {};
      for (const [mint, price] of Object.entries(body.data ?? {})) {
        if (typeof price === 'number' && price > 0) out[mint] = price;
      }
      return out;
    };
    if (fetcher) return run();
    return this.cached(key, PRICES_TTL_MS, run) as Promise<Record<string, number>>;
  }

  async candles(
    mint: string,
    opts: { interval?: string; count?: number; from?: number; to?: number } = {},
    fetcher?: FetchLike,
  ): Promise<Candle[]> {
    // `from`/`to` pin windows down to the second — caching them would poison
    // the cache with per-call keys, so only cache coarse (window-free) queries.
    const cacheable = opts.from === undefined && opts.to === undefined;
    const key = `candles:${mint}:${opts.interval ?? ''}:${opts.count ?? ''}`;
    const run = async (): Promise<Candle[]> => {
      const q = new URLSearchParams();
      if (opts.interval) q.set('interval', opts.interval);
      if (opts.count) q.set('count', String(opts.count));
      if (opts.from) q.set('from', String(opts.from));
      if (opts.to) q.set('to', String(opts.to));
      const qs = q.toString();
      const rows = await this.get<unknown[]>(`/tokens/${mint}/candles${qs ? `?${qs}` : ''}`, fetcher);
      if (!Array.isArray(rows)) return [];
      return rows
        .filter(
          (r): r is Record<string, number> =>
            !!r && typeof r === 'object' && ['open', 'high', 'low', 'close'].every((k) => typeof (r as Record<string, number>)[k] === 'number'),
        )
        .map((r) => ({ open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? 0, timestamp: r.timestamp ?? 0 }));
    };
    if (fetcher || !cacheable) return run();
    return this.cached(key, CANDLES_TTL_MS, run) as Promise<Candle[]>;
  }

  /** Token details (marketCap for liquidity gating). Null on any failure. */
  async tokenDetails(
    mint: string,
    fetcher?: FetchLike,
  ): Promise<{ marketCap?: number; price?: number } | null> {
    try {
      const body = await this.get<Record<string, unknown>>(
        `/tokens/${mint}/details`,
        fetcher,
      );
      const out: { marketCap?: number; price?: number } = {};
      if (typeof body.marketCap === 'number') out.marketCap = body.marketCap;
      if (typeof body.price === 'number') out.price = body.price;
      return out;
    } catch {
      return null;
    }
  }
  /** 14-period ATR on 1h closes (fraction of price). Null when insufficient data. */
  static atrFraction(candles: Candle[], period = 14): number | null {
    if (candles.length < period + 1) return null;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const recent = trs.slice(-period);
    const atr = recent.reduce((s, v) => s + v, 0) / recent.length;
    const ref = candles[candles.length - 1].close;
    if (!(atr > 0) || !(ref > 0)) return null;
    return atr / ref;
  }

  /** Solution v2 stop suggestion: clamp(2×ATR, 8%, 40%). Null without data. */
  static suggestStopPct(candles: Candle[]): number | null {
    const f = DataStreamService.atrFraction(candles);
    if (f === null) return null;
    return Math.min(40, Math.max(8, Math.round(f * 200 * 100) / 100));
  }

  /** ATR regime (RR 1:2 anchored on the ATR stop). Null without enough candles. */
  static suggestRegime(candles: Candle[]): AtrRegime | null {
    const f = DataStreamService.atrFraction(candles);
    if (f === null) return null;
    const stop = DataStreamService.suggestStopPct(candles);
    if (stop === null) return null;
    const atrPct = Math.round(f * 100 * 100) / 100;
    return {
      atrPct,
      stopPct: stop,
      tp1Pct: Math.min(120, Math.max(20, stop * 2)),
      trailPct: Math.min(30, Math.max(10, stop)),
      regime: atrPct < 1 ? 'calm' : atrPct <= 3 ? 'normal' : 'wild',
    };
  }
}

export interface AtrRegime {
  atrPct: number;
  stopPct: number;
  tp1Pct: number;
  trailPct: number;
  regime: 'calm' | 'normal' | 'wild';
}
