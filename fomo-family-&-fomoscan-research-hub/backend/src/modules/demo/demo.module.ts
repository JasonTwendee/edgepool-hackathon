import { Module } from '@nestjs/common';
import { CopyTradeModule } from '../copy-trade/copy-trade.module.js';
import { VaultsModule } from '../vaults/vaults.module.js';
import { BotsModule } from '../bots/bots.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';

@Module({
  imports: [CopyTradeModule, VaultsModule, BotsModule, AuditModule],
  controllers: [DemoController],
  providers: [DemoService, DataStreamService],
  exports: [DemoService],
})
export class DemoModule {}
