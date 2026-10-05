import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { VaultsController } from './vaults.controller.js';
import { VaultService } from './vault.service.js';

@Module({
  imports: [AuditModule],
  controllers: [VaultsController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultsModule {}
