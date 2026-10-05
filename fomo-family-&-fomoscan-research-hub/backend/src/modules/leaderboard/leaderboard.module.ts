import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { FomoscanService } from '../../common/fomoscan/fomoscan.service.js';
import { LeaderboardController } from './leaderboard.controller.js';
import { LeaderboardService } from './leaderboard.service.js';

@Module({
  imports: [AuditModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, FomoscanService],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
