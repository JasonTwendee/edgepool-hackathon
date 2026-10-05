import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BotsController } from './bots.controller.js';
import { BotsService } from './bots.service.js';

@Module({
  imports: [AuditModule],
  controllers: [BotsController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
