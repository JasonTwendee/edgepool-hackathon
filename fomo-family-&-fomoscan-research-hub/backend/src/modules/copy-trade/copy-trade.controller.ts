import { Body, Controller, Get, Inject, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { CopyTradeService } from './copy-trade.service.js';
import { AutoFireService } from './auto-fire.service.js';
import { ManageService } from './manage.service.js';
import { AllocationService } from './allocation.service.js';
import { ExecuteCopyDto } from './dto/execute-copy.dto.js';
import { AutoFireTickDto } from './dto/auto-fire-tick.dto.js';
import { ManageTickDto } from './dto/manage-tick.dto.js';
import { RebalanceDto } from './dto/rebalance.dto.js';

@Controller('api/copy-trade')
export class CopyTradeController {
  constructor(
    @Inject(CopyTradeService) private readonly copyTrade: CopyTradeService,
    @Inject(AutoFireService) private readonly autoFire: AutoFireService,
    @Inject(ManageService) private readonly manage: ManageService,
    @Inject(AllocationService) private readonly alloc: AllocationService,
  ) {}

  @Post('execute')
  async execute(@Body() body: Record<string, unknown>) {
    const dto = await validateDto(ExecuteCopyDto, body);
    // Paper path (devnet, 1-click gated) — validation failures throw 400
    // envelopes via validateDto; execution failures via the service.
    if (dto.mode === 'paper') {
      const order = await this.copyTrade.executePaper(dto);
      return { success: true, copyRecord: order };
    }
    const copyRecord = this.copyTrade.execute(dto);
    return { success: true, copyRecord };
  }

  @Get('history')
  async history(@Query() query: Record<string, string | string[] | undefined>) {
    const rawWallet = query.wallet;
    const wallet = typeof rawWallet === 'string' && rawWallet ? rawWallet : undefined;
    const rawLimit = query.limit;
    const parsed = typeof rawLimit === 'string' ? parseInt(rawLimit, 10) : NaN;
    const limit = Number.isFinite(parsed) ? parsed : 20;
    const { total, data } = await this.copyTrade.listHistory(wallet, limit);
    return { success: true, total, data };
  }

  @Post('auto-fire/tick')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('copy.auto_fire_tick')
  async autoFireTick(@Body() body: Record<string, unknown>) {
    const dto = await validateDto(AutoFireTickDto, body);
    const data = await this.autoFire.tick(dto.minutes ?? 15, dto.limit ?? 10);
    return { success: true, data: { ...data, environment: 'sandbox' } };
  }

  @Post('manage/tick')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('copy.manage_tick')
  async manageTick(@Body() body: Record<string, unknown>) {
    const dto = await validateDto(ManageTickDto, body);
    const data = await this.manage.tick(dto.limit ?? 50);
    return { success: true, data: { ...data, environment: 'sandbox' } };
  }

  @Post('allocation/rebalance')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('copy.alloc_rebalance_tick')
  async rebalance(@Body() body: Record<string, unknown>) {
    const dto = await validateDto(RebalanceDto, body);
    const data =
      dto.vaultId !== undefined ? await this.alloc.rebalance(dto.vaultId) : await this.alloc.rebalanceAll();
    return { success: true, data: { ...data, environment: 'sandbox' } };
  }
}
