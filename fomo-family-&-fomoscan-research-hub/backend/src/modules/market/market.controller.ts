import { Controller, Get, Inject, Query } from '@nestjs/common';
import { MarketService } from './market.service.js';

@Controller('api/market')
export class MarketController {
  constructor(@Inject(MarketService) private readonly market: MarketService) {}

  @Get('ticks')
  async ticks() {
    const { ticks, stale } = await this.market.ticks();
    return { success: true, stale, data: ticks };
  }

  @Get('prices')
  async prices(@Query() query: Record<string, string | string[] | undefined>) {
    const raw = query.mints;
    const mints = typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (mints.length === 0) {
      return { success: true, data: {} };
    }
    const data = await this.market.prices(mints);
    return { success: true, data };
  }
}
