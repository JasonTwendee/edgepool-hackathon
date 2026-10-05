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
@Injectable()
export class MarketService {
  constructor(@Inject(DataStreamService) private readonly ds: DataStreamService) {}

  async ticks(): Promise<{ ticks: (MarketTick & { glyph: string })[]; stale: boolean }> {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,usd-coin&vs_currencies=usd&include_24hr_change=true&precision=2',
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const body = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
      return {
        ticks: MAJORS.map((m) => ({
          ...m,
          priceUsd: typeof body[m.id]?.usd === 'number' ? (body[m.id] as { usd: number }).usd : null,
          changePct24h:
            typeof body[m.id]?.usd_24h_change === 'number'
              ? Math.round((body[m.id] as { usd_24h_change: number }).usd_24h_change * 100) / 100
              : null,
        })),
        stale: false,
      };
    } catch {
      return { ticks: MAJORS.map((m) => ({ ...m, priceUsd: null, changePct24h: null })), stale: true };
    }
  }

  async prices(mints: string[]): Promise<Record<string, number>> {
    const clean = [...new Set(mints.filter(Boolean))].slice(0, 50);
    return this.ds.bulkPrices(clean);
  }
}
