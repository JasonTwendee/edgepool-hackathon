import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';
import { FomoscanService } from '../../common/fomoscan/fomoscan.service.js';

@Module({
  imports: [AuditModule],
  controllers: [WalletsController],
  providers: [WalletsService, FomoscanService],
  exports: [WalletsService],
})
export class WalletsModule {}
