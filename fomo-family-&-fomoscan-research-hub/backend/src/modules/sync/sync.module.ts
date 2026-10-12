import { Module } from '@nestjs/common';
import { HeliusModule } from '../helius/helius.module.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { TxParseService } from '../../common/chain/tx-parse.service.js';
import { HistorySyncService } from './history-sync.service.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [WalletsModule, TransactionsModule, PortfolioModule, HeliusModule, AuditModule],
  providers: [HistorySyncService, SyncService, DataStreamService, TxParseService],
  exports: [HistorySyncService],
})
export class SyncModule {}
