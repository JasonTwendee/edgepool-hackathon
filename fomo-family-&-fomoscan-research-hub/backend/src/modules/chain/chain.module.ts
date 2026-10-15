import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ChainProgramClient } from './program.client.js';
import { ChainIndexerService } from './indexer.service.js';
import { ChainKeeperService } from './keeper.service.js';
import { ChainReconcileService } from './reconcile.service.js';
import { ChainFaucetController } from './faucet.controller.js';
import { DataStreamService } from '../../common/market/datastream.service.js';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ChainFaucetController],
  providers: [
    ChainProgramClient,
    ChainIndexerService,
    ChainKeeperService,
    ChainReconcileService,
    DataStreamService,
  ],
  exports: [ChainProgramClient],
})
export class ChainModule {}
