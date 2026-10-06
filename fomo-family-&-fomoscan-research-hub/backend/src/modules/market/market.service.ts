import { Inject, Injectable } from '@nestjs/common';
import { DataStreamService } from '../../common/market/datastream.service.js';

export interface MarketTick {
  id: string;
  label: string;
  priceUsd: number | null;
  changePct24h: number | null;
}

const MAJORS = [
  { id: 'bitcoin', label: 'BTC', glyph: '₿' },
  { id: 'ethereum', label: 'ETH', glyph: 'Ξ' },
  { id: 'solana', label: 'SOL', glyph: '◎' },
  { id: 'usd-coin', label: 'USDC', glyph: '$' },
];

/**
 * Server-side market proxy — keeps third-party keys off the frontend.
 * Majors ticker via CoinGecko (keyless ids); token mints via DataStream.
 */
export const TICKS_TTL_MS =
  process.env.COINGECKO_TICKS_TTL_MS !== undefined ? Number(process.env.COINGECKO_TICKS_TTL_MS) : 90000;

type TicksFetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

@Injectable()
export class MarketService {
  constructor(@Inject(DataStreamService) private readonly ds: DataStreamService) {}
  private cachedAt = 0;
  private cachedTicks: (MarketTick & { glyph: string })[] | null = null;
  private inflight: Promise<(MarketTick & { glyph: string })[]> | null = null;

  async ticks(fetcher?: TicksFetcher): Promise<{ ticks: (MarketTick & { glyph: string })[]; stale: boolean }> {
    // Shared cache + single-flight across all FE clients (G1): without this,
    // every 60s poll of every open tab is one CoinGecko call → instant 429.
    if (!fetcher) {
      if (this.cachedTicks && Date.now() - this.cachedAt < TICKS_TTL_MS && TICKS_TTL_MS > 0) {
        return { ticks: this.cachedTicks, stale: false };
      }
      if (this.inflight) {
        try {
          return { ticks: await this.inflight, stale: false };
        } catch {
          return { ticks: MAJORS.map((m) => ({ ...m, priceUsd: null, changePct24h: null })), stale: true };
        }
      }
    }
    const run = (async () => {
      try {
        const res = await (fetcher ?? fetch)(
          'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,usd-coin&vs_currencies=usd&include_24hr_change=true&precision=2',
          { signal: AbortSignal.timeout(10000) },
        );
        if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
        const body = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
        return MAJORS.map((m) => ({
          ...m,
          priceUsd: typeof body[m.id]?.usd === 'number' ? (body[m.id] as { usd: number }).usd : null,
          changePct24h:
            typeof body[m.id]?.usd_24h_change === 'number'
              ? Math.round((body[m.id] as { usd_24h_change: number }).usd_24h_change * 100) / 100
              : null,
        }));
      } catch {
        return MAJORS.map((m) => ({ ...m, priceUsd: null, changePct24h: null }));
      }
    })();
    if (fetcher) {
      const ticks = await run;
      return { ticks, stale: ticks.every((t) => t.priceUsd === null) };
    }
    this.inflight = run;
    try {
      const ticks = await run;
      const failed = ticks.every((t) => t.priceUsd === null);
      if (!failed) {
        this.cachedTicks = ticks;
        this.cachedAt = Date.now();
      }
      return { ticks, stale: failed };
    } finally {
      this.inflight = null;
    }
  }

  async prices(mints: string[]): Promise<Record<string, number>> {
    const clean = [...new Set(mints.filter(Boolean))].slice(0, 50);
    return this.ds.bulkPrices(clean);
  }
}
