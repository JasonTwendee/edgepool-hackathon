import { Module } from '@nestjs/common';
import { MarketController } from './market.controller.js';
import { MarketService } from './market.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';

@Module({
  controllers: [MarketController],
  providers: [MarketService, DataStreamService],
  exports: [MarketService],
})
export class MarketModule {}
