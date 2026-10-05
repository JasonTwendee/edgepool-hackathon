import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { HeliusModule } from './modules/helius/helius.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { PortfolioModule } from './modules/portfolio/portfolio.module.js';
import { OnchainModule } from './modules/onchain/onchain.module.js';
import { CopyTradeModule } from './modules/copy-trade/copy-trade.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { BotsModule } from './modules/bots/bots.module.js';
import { DemoModule } from './modules/demo/demo.module.js';
import { MarketModule } from './modules/market/market.module.js';
import { VaultsModule } from './modules/vaults/vaults.module.js';
import { SolanaModule } from './server/solana.module.js';
import { SyncModule } from './modules/sync/sync.module.js';

@Module({
  imports: [
    PrismaModule,
    SolanaModule,
    HeliusModule,
    HealthModule,
    WalletsModule,
    PortfolioModule,
    OnchainModule,
    CopyTradeModule,
    AuthModule,
    UsersModule,
    AuditModule,
    BotsModule,
    DemoModule,
    MarketModule,
    VaultsModule,
    SyncModule,
  ],
})
export class AppModule {}
