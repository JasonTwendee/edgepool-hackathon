import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, AuthedUser, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { DemoService } from './demo.service.js';
import { ReplayDto, SeedDto } from './dto/demo.dto.js';

@Controller('api/demo')
export class DemoController {
  constructor(@Inject(DemoService) private readonly demo: DemoService) {}

  private actor(req: { user?: AuthedUser }): string {
    return req.user?.wallet ?? 'unknown-admin';
  }

  @Post('seed')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('demo.seed_tick')
  async seed(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(SeedDto, body);
    const data = await this.demo.seed(
      { name: dto.name, depositSol: dto.depositSol, traderCount: dto.traderCount },
      this.actor(req),
    );
    return { success: true, data };
  }

  @Post('replay')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('demo.replay_tick')
  async replay(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(ReplayDto, body);
    const data = await this.demo.replay(
      { vaultId: dto.vaultId, botId: dto.botId, days: dto.days, limit: dto.limit },
      this.actor(req),
    );
    return { success: true, data };
  }

  @Post('reset')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('demo.reset_tick')
  async reset(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; data: unknown }> {
    const data = await this.demo.reset(this.actor(req));
    return { success: true, data };
  }

  @Post('scenario')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('demo.scenario_tick')
  async scenario(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; data: unknown }> {
    const data = await this.demo.scenario(this.actor(req));
    return { success: true, data };
  }

  @Get('bot/:id/performance')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  async performance(@Param('id') id: string): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const data = await this.demo.performance(Number.isFinite(parsed) ? parsed : -1);
    return { success: true, data };
  }
}
