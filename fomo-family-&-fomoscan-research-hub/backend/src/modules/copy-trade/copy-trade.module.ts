import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CopyTradeController } from './copy-trade.controller.js';
import { CopyTradeService } from './copy-trade.service.js';
import { AutoFireService } from './auto-fire.service.js';
import { ManageService } from './manage.service.js';
import { AllocationService } from './allocation.service.js';
import { PaperExecutorService } from './paper-executor.service.js';
import { RugCheckService } from '../../common/rugcheck/rugcheck.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { VaultsModule } from '../vaults/vaults.module.js';

@Module({
  imports: [VaultsModule, AuditModule],
  controllers: [CopyTradeController],
  providers: [CopyTradeService, AutoFireService, ManageService, AllocationService, PaperExecutorService, RugCheckService, DataStreamService],
  exports: [CopyTradeService, AutoFireService, ManageService, AllocationService],
})
export class CopyTradeModule {}
