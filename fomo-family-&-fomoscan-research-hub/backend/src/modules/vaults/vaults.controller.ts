import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Sse, UseGuards, UseInterceptors } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SSE_HEARTBEAT_MS } from '../../config/solana.config.js';
import { subscribeSignals } from '../copy-trade/signal-bus.js';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, AuthedUser, OptionalAuthGuard, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { VaultService } from './vault.service.js';
import { AssignTraderDto, CreateVaultDto, VaultDepositDto, VaultPolicyDto, VaultSettleDto, VaultWithdrawDto } from './dto/vault.dto.js';

@Controller('api/vaults')
export class VaultsController {
  constructor(@Inject(VaultService) private readonly vaults: VaultService) {}

  @Get()
  async list(): Promise<{ success: boolean; total: number; data: unknown }> {
    const data = (await this.vaults.listVaults()) as unknown[];
    return { success: true, total: data.length, data };
  }

  @Get('pools')
  @UseGuards(OptionalAuthGuard)
  async pools(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; total: number; data: unknown }> {
    const data = (await this.vaults.pools(req.user ?? undefined)) as unknown[];
    return { success: true, total: data.length, data };
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('vault.create')
  async create(@Body() body: Record<string, unknown>): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(CreateVaultDto, body);
    const data = await this.vaults.createVault(dto.name);
    return { success: true, data };
  }

  @Get(':id/traders')
  async traders(@Param('id') id: string): Promise<{ success: boolean; total: number; data: unknown }> {
    const parsed = parseInt(id, 10);
    const vaults = (await this.vaults.listVaults()) as { id: number; traders: unknown[] }[];
    const found = vaults.find((v) => v.id === (Number.isFinite(parsed) ? parsed : -1));
    const data = found ? found.traders : [];
    return { success: true, total: data.length, data };
  }

  @Post(':id/traders')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('vault.assign_trader')
  async assignTrader(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const dto = await validateDto(AssignTraderDto, body);
    const data = await this.vaults.assignTrader(
      Number.isFinite(parsed) ? parsed : -1,
      dto.wallet,
      dto.weightBps ?? 0,
    );
    return { success: true, data };
  }

  @Delete(':id/traders/:wallet')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('vault.remove_trader')
  async removeTrader(
    @Param('id') id: string,
    @Param('wallet') wallet: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const data = await this.vaults.removeTrader(Number.isFinite(parsed) ? parsed : -1, wallet);
    return { success: true, data };
  }

  @Post(':id/policy')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('vault.set_policy')
  async setPolicy(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const dto = await validateDto(VaultPolicyDto, body);
    const data = await this.vaults.setPolicy(Number.isFinite(parsed) ? parsed : -1, {
      feeBps: dto.feeBps,
      reserveBps: dto.reserveBps,
      withdrawFeeBps: dto.withdrawFeeBps,
      lockHours: dto.lockHours,
      settlePeriodHours: dto.settlePeriodHours,
      settleLengthMin: dto.settleLengthMin,
    });
    return { success: true, data: { ...data, environment: 'sandbox' } };
  }

  @Get(':id/pool')
  @UseGuards(OptionalAuthGuard)
  async poolDetail(
    @Param('id') id: string,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const data = await this.vaults.poolDetail(Number.isFinite(parsed) ? parsed : -1, req.user ?? undefined);
    return { success: true, data };
  }

  @Get(':id/earnings')
  async earnings(
    @Param('id') id: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const raw = query.trader;
    const data = await this.vaults.earnings(
      Number.isFinite(parsed) ? parsed : -1,
      typeof raw === 'string' ? raw : undefined,
    );
    return { success: true, data };
  }

  @Sse(':id/signals/stream')
  signalStream(@Param('id') id: string): Observable<{ data: unknown }> {
    const parsed = parseInt(id, 10);
    const vaultId = Number.isFinite(parsed) ? parsed : -1;
    return new Observable<{ data: unknown }>((observer) => {
      observer.next({ data: { type: 'CONNECTED', vaultId, timestamp: Date.now() } });
      // Replay: persisted orders first (so the terminal never opens empty),
      // then live bus events from auto-fire / manage ticks.
      void this.vaults
        .recentSignalEvents(vaultId, 30)
        .then((events) => observer.next({ data: { type: 'REPLAY', vaultId, events } }))
        .catch(() => undefined);
      const unsubscribe = subscribeSignals(vaultId, (event) => {
        observer.next({ data: { type: 'SIGNAL', event } });
      });
      const heartbeat = setInterval(() => {
        observer.next({ data: { type: 'PING', timestamp: Date.now() } });
      }, SSE_HEARTBEAT_MS);
      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }

  @Post('deposit')
  @UseGuards(AuthGuard)
  async deposit(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(VaultDepositDto, body);
    // Fix #4: session identity is authoritative — client `depositor` is
    // display-only and ignored. Anonymous deposits are rejected (401).
    const row = await this.vaults.deposit(dto.vaultId ?? 1, req.user as AuthedUser, dto.amountSol);
    return { success: true, data: row };
  }

  @Post('withdraw')
  @UseGuards(AuthGuard)
  async withdraw(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ) {
    const dto = await validateDto(VaultWithdrawDto, body);
    const row = await this.vaults.requestWithdraw(dto.vaultId ?? 1, req.user as AuthedUser, dto.shares);
    return { success: true, data: row };
  }

  @Post('settle')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('vault.settle')
  async settle(@Body() body: Record<string, unknown>) {
    const dto = await validateDto(VaultSettleDto, body);
    const result = await this.vaults.settleEpoch(dto.vaultId ?? 1, dto.navSol);
    return { success: true, data: result };
  }

  @Get('status')
  async status(@Query() query: Record<string, string | string[] | undefined>) {
    const raw = query.vaultId;
    const parsed = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    const data = await this.vaults.status(Number.isFinite(parsed) ? parsed : 1);
    return { success: true, data };
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  async mine(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const raw = query.vaultId;
    const parsed = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    const data = await this.vaults.mine(Number.isFinite(parsed) ? parsed : 1, req.user as AuthedUser);
    return { success: true, data };
  }

  @Get('portfolio')
  @UseGuards(AuthGuard)
  async portfolio(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; data: unknown }> {
    const data = await this.vaults.portfolioOverview(req.user as AuthedUser);
    return { success: true, data };
  }

  @Delete('withdraw/:id')
  @UseGuards(AuthGuard)
  async cancelWithdraw(
    @Param('id') id: string,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const data = await this.vaults.cancelWithdraw(Number.isFinite(parsed) ? parsed : -1, req.user as AuthedUser);
    return { success: true, data };
  }
}
