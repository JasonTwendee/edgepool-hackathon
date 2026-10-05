import { BadRequestException, Controller, Get, Inject, InternalServerErrorException, Query } from '@nestjs/common';
import { parsePortfolioQuery } from './dto/portfolio-query.dto.js';
import { HoldingsService } from './holdings.service.js';
import { PnlService } from './pnl.service.js';
import { PortfolioService } from './portfolio.service.js';

function parseDays(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3650) : fallback;
}

@Controller('api/portfolio')
export class PortfolioController {
  constructor(
    @Inject(PortfolioService) private readonly portfolio: PortfolioService,
    @Inject(PnlService) private readonly pnl: PnlService,
    @Inject(HoldingsService) private readonly holdings: HoldingsService,
  ) {}

  @Get('transactions')
  async getTransactions(@Query() rawQuery: Record<string, unknown>) {
    try {
      const query = parsePortfolioQuery(rawQuery);
      const { transactions, total, totalPages, walletsCount } =
        await this.portfolio.getTransactions(query);
      return {
        success: true,
        total,
        walletsCount,
        page: query.page,
        pageSize: query.pageSize,
        totalPages,
        asOf: new Date().toISOString(),
        data: transactions,
      };
    } catch (err: unknown) {
      throw new InternalServerErrorException({
        success: false,
        message: (err as Error).message || 'Lỗi truy vấn lịch sử on-chain',
      });
    }
  }

  @Get('pnl')
  async getPnl(@Query() rawQuery: Record<string, unknown>) {
    const wallet =
      typeof rawQuery.wallet === 'string' && rawQuery.wallet.length > 0
        ? rawQuery.wallet
        : undefined;
    if (!wallet || wallet === 'ALL') {
      throw new BadRequestException({
        success: false,
        message: 'Tham số wallet (địa chỉ ví cụ thể) là bắt buộc.',
      });
    }
    const data = await this.pnl.getWalletPnl(wallet, parseDays(rawQuery.days, 30));
    return { success: true, asOf: new Date().toISOString(), data };
  }

  @Get('pnl/overview')
  async getPnlOverview(@Query() rawQuery: Record<string, unknown>) {
    const data = await this.pnl.getOverview(parseDays(rawQuery.days, 30));
    return {
      success: true,
      total: data.length,
      asOf: new Date().toISOString(),
      data,
    };
  }

  @Get('holdings')
  async getHoldings(@Query() rawQuery: Record<string, unknown>) {
    const wallet =
      typeof rawQuery.wallet === 'string' && rawQuery.wallet.length > 0
        ? rawQuery.wallet
        : undefined;
    if (!wallet || wallet === 'ALL') {
      throw new BadRequestException({
        success: false,
        message: 'Tham số wallet (địa chỉ ví cụ thể) là bắt buộc.',
      });
    }
    try {
      const data = await this.holdings.getHoldings(wallet);
      return { success: true, asOf: data.asOf, data };
    } catch (err: unknown) {
      throw new InternalServerErrorException({
        success: false,
        message: (err as Error).message || 'Lỗi truy vấn holdings',
      });
    }
  }
}
