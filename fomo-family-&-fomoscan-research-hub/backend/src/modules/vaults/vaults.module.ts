import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { SignedIntentModule } from '../signed-intent/signed-intent.module.js';
import { VaultsController } from './vaults.controller.js';
import { VaultService } from './vault.service.js';

@Module({
  imports: [AuditModule, SignedIntentModule],
  controllers: [VaultsController],
  providers: [VaultService, DataStreamService],
  exports: [VaultService],
})
export class VaultsModule {}
