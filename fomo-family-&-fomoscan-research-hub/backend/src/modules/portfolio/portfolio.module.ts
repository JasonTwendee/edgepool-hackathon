import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { HoldingsService } from './holdings.service.js';
import { PnlService } from './pnl.service.js';
import { PortfolioController } from './portfolio.controller.js';
import { PortfolioService } from './portfolio.service.js';

@Module({
  imports: [WalletsModule, TransactionsModule],
  controllers: [PortfolioController],
  providers: [PortfolioService, PnlService, HoldingsService, DataStreamService],
  exports: [PortfolioService, PnlService, HoldingsService],
})
export class PortfolioModule {}
