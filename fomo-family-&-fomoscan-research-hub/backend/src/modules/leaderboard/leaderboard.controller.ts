import { Controller, Get, Inject, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { LeaderboardService } from './leaderboard.service.js';

@Controller('api/wallets/rotation')
export class LeaderboardController {
  constructor(@Inject(LeaderboardService) private readonly rotation: LeaderboardService) {}

  @Get('status')
  async status(): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rotation.status();
    return { success: true, data };
  }

  @Post('tick')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('wallet.rotation')
  async tick(): Promise<{ success: boolean; data: unknown }> {
    const data = await this.rotation.tick();
    return { success: true, data };
  }
}
