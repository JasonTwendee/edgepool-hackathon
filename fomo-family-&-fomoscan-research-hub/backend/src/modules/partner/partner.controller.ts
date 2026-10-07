import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, AuthedUser, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { PartnerService } from './partner.service.js';
import { ApplyDto, PayoutChallengeDto, PayoutWalletDto, PoolSettingsDto, RequestTraderDto, ReviewApplicationDto } from './dto/partner.dto.js';

@Controller('api/partner')
export class PartnerController {
  constructor(@Inject(PartnerService) private readonly partner: PartnerService) {}

  @Post('apply')
  async apply(@Body() body: Record<string, unknown>): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(ApplyDto, body);
    const data = await this.partner.apply({ fomoHandle: dto.fomoHandle, xHandle: dto.xHandle, wallet: dto.wallet, contact: dto.contact });
    return { success: true, data };
  }

  @Get('apply/status')
  async applyStatus(@Query() query: Record<string, string | string[] | undefined>): Promise<{ success: boolean; data: unknown }> {
    const raw = query.wallet;
    const data = await this.partner.applyStatus(typeof raw === 'string' ? raw : '');
    return { success: true, data };
  }

  @Get('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  async me(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; data: unknown }> {
    const data = await this.partner.me(req.user as AuthedUser);
    return { success: true, data };
  }

  @Post('payout-wallet/challenge')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  async payoutChallenge(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(PayoutChallengeDto, body);
    const data = await this.partner.issuePayoutChallenge(req.user as AuthedUser, dto.wallet);
    return { success: true, data };
  }

  @Post('payout-wallet')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  async payoutWallet(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(PayoutWalletDto, body);
    const data = await this.partner.setPayoutWallet(req.user as AuthedUser, dto.wallet, dto.signature);
    return { success: true, data };
  }

  @Post('claim')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner.claim')
  async claim(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; data: unknown }> {
    const data = await this.partner.claim(req.user as AuthedUser);
    return { success: true, data };
  }

  @Patch('pools/:id/settings')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner.update_settings')
  async settings(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(PoolSettingsDto, body);
    const parsed = parseInt(id, 10);
    const data = await this.partner.updateSettings(Number.isFinite(parsed) ? parsed : -1, req.user as AuthedUser, dto as Record<string, unknown>);
    return { success: true, data };
  }

  @Get('pools/:id/traders')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  async traders(
    @Param('id') id: string,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; total: number; data: unknown }> {
    const parsed = parseInt(id, 10);
    const data = (await this.partner.poolTraders(Number.isFinite(parsed) ? parsed : -1, req.user as AuthedUser)) as unknown[];
    return { success: true, total: data.length, data };
  }

  @Post('pools/:id/traders/:wallet/pause')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner.pause_trader')
  async pauseTrader(
    @Param('id') id: string,
    @Param('wallet') wallet: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const active = (body as { active?: boolean }).active ?? false;
    const data = await this.partner.pauseTrader(Number.isFinite(parsed) ? parsed : -1, req.user as AuthedUser, wallet, active);
    return { success: true, data };
  }

  @Post('pools/:id/request-trader')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  async requestTrader(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(RequestTraderDto, body);
    const parsed = parseInt(id, 10);
    const data = await this.partner.requestTrader(Number.isFinite(parsed) ? parsed : -1, req.user as AuthedUser, { fomoHandle: dto.fomoHandle, xHandle: dto.xHandle });
    return { success: true, data };
  }

  @Get('signals')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  async signals(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; total: number; data: unknown }> {
    const raw = query.vaultId;
    const parsed = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    const data = (await this.partner.signals(req.user as AuthedUser, Number.isFinite(parsed) ? parsed : undefined)) as unknown[];
    return { success: true, total: data.length, data };
  }

  @Get('payouts')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('KOL', 'ADMIN')
  async payouts(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; total: number; data: unknown }> {
    const data = (await this.partner.payouts(req.user as AuthedUser)) as unknown[];
    return { success: true, total: data.length, data };
  }

  @Get('applications')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  async applications(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; total: number; data: unknown }> {
    const data = (await this.partner.applications(req.user as AuthedUser)) as unknown[];
    return { success: true, total: data.length, data };
  }

  @Post('applications/:id/review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner.review_application')
  async review(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(ReviewApplicationDto, body);
    const parsed = parseInt(id, 10);
    const data = await this.partner.reviewApplication(Number.isFinite(parsed) ? parsed : -1, req.user as AuthedUser, { decision: dto.decision, vaultId: dto.vaultId, userId: dto.userId });
    return { success: true, data };
  }

  @Delete('pools/:id/traders/:wallet')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('partner.remove_trader')
  async removeTrader(
    @Param('id') id: string,
    @Param('wallet') wallet: string,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const data = await this.partner.pauseTrader(Number.isFinite(parsed) ? parsed : -1, req.user as AuthedUser, wallet, false);
    return { success: true, data };
  }
}
