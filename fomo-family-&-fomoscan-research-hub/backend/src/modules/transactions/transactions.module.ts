import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service.js';

@Module({
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
