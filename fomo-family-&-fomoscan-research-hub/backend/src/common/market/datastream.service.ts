import { Injectable } from '@nestjs/common';

/**
 * FluxBeam DataStream client (prices + candles). No key required for these
 * endpoints today; DATASTREAM_API_KEY is attached when present (header +
 * query variants attempted once each on 401).
 */
export const DATASTREAM_BASE_URL = 'https://data.fluxbeam.xyz';

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

  // NOTE: no-arg constructor (tsx-safe DI). Use configure() in tests.
  constructor() {
    this.base = (process.env.DATASTREAM_BASE_URL || DATASTREAM_BASE_URL).replace(/\/$/, '');
    this.apiKey = process.env.DATASTREAM_API_KEY || undefined;
  }

  configure(base?: string, apiKey?: string): this {
    if (base) this.base = base.replace(/\/$/, '');
    if (apiKey !== undefined) this.apiKey = apiKey || undefined;
    return this;
  }

  private async get<T>(path: string, fetcher: FetchLike = netFetch): Promise<T> {
    // v1: plain GET (open endpoints). Key attached as query when present.
    const sep = path.includes('?') ? '&' : '?';
    const url = this.apiKey ? `${this.base}${path}${sep}key=${this.apiKey}` : `${this.base}${path}`;
    const res = await fetcher(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`DataStream ${res.status} for ${path.split('?')[0]}`);
    return (await res.json()) as T;
  }

  /** Mint → USD (bulk, max 255). Returns only mints the API priced. */
  async bulkPrices(mints: string[], fetcher?: FetchLike): Promise<Record<string, number>> {
    if (mints.length === 0) return {};
    const body = await this.get<{ data?: Record<string, number> }>(
      `/prices?ids=${mints.map(encodeURIComponent).join(',')}`,
      fetcher,
    );
    const out: Record<string, number> = {};
    for (const [mint, price] of Object.entries(body.data ?? {})) {
      if (typeof price === 'number' && price > 0) out[mint] = price;
    }
    return out;
  }

  async candles(
    mint: string,
    opts: { interval?: string; count?: number; from?: number; to?: number } = {},
    fetcher?: FetchLike,
  ): Promise<Candle[]> {
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
