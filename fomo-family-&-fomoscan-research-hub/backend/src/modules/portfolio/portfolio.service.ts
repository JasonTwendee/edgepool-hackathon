import { Inject, Injectable } from '@nestjs/common';
import type { OnChainTransactionEvent } from '../onchain/entities/onchain-event.entity.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { WalletsService } from '../wallets/wallets.service.js';

export interface TransactionsQuery {
  wallet: string; // address or 'ALL'
  page: number;
  pageSize: number;
  action?: 'BUY' | 'SELL';
  days: number;
  hideZero: boolean;
}

/**
 * Portfolio ledger: pure Postgres reads (DB is filled by the 60s history sync
 * + WS stream pipeline). paginated, filterable by action + day window.
 */
@Injectable()
export class PortfolioService {
  constructor(
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(TransactionsService) private readonly tx: TransactionsService,
  ) {}

  async getTransactions(query: TransactionsQuery): Promise<{
    transactions: OnChainTransactionEvent[];
    total: number;
    totalPages: number;
    walletsCount: number;
  }> {
    const cutoff = Math.floor(Date.now() / 1000) - query.days * 86400;
    const skip = (query.page - 1) * query.pageSize;
    if (query.wallet !== 'ALL') {
      const exists = await this.wallets.findByAddress(query.wallet);
      if (!exists) return { transactions: [], total: 0, totalPages: 0, walletsCount: 0 };
      const { rows, total } = await this.tx.queryLedger({
        walletAddress: query.wallet,
        action: query.action,
        hideZero: query.hideZero,
        sinceSec: cutoff,
        skip,
        take: query.pageSize,
      });
      return {
        transactions: rows,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        walletsCount: 1,
      };
    }
    const wallets = await this.wallets.findAllLive();
    const { rows, total } = await this.tx.queryLedger({
      action: query.action,
      hideZero: query.hideZero,
      sinceSec: cutoff,
      skip,
      take: query.pageSize,
    });
    return {
      transactions: rows,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      walletsCount: wallets.length,
    };
  }
}
