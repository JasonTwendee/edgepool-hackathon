import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SignedIntentController } from './signed-intent.controller.js';
import { SignedIntentService } from './signed-intent.service.js';

@Module({
  imports: [AuditModule],
  controllers: [SignedIntentController],
  providers: [SignedIntentService],
  exports: [SignedIntentService],
})
export class SignedIntentModule {}
