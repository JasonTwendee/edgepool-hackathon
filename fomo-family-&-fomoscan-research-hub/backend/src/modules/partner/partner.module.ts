import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { VaultsModule } from '../vaults/vaults.module.js';
import { PartnerController } from './partner.controller.js';
import { PartnerService } from './partner.service.js';

@Module({
  imports: [AuditModule, VaultsModule],
  controllers: [PartnerController],
  providers: [PartnerService, DataStreamService],
  exports: [PartnerService],
})
export class PartnerModule {}
