import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { TxParseService } from '../../common/chain/tx-parse.service.js';
import { OnchainController } from './onchain.controller.js';
import { OnchainService } from './onchain.service.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [TransactionsModule],
  controllers: [OnchainController, WebhooksController],
  providers: [OnchainService, TxParseService, DataStreamService],
})
export class OnchainModule {}
