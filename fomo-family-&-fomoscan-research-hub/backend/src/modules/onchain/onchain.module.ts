import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { OnchainController } from './onchain.controller.js';
import { OnchainService } from './onchain.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [TransactionsModule],
  controllers: [OnchainController, WebhooksController],
  providers: [OnchainService],
})
export class OnchainModule {}
