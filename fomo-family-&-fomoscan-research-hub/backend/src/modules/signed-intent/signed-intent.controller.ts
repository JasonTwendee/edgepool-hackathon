import { Body, Controller, Inject, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, AuthedUser } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { SignedIntentService } from './signed-intent.service.js';
import { DepositChallengeDto, WithdrawChallengeDto } from './dto/signed-intent.dto.js';

@Controller('api/vaults')
export class SignedIntentController {
  constructor(@Inject(SignedIntentService) private readonly intents: SignedIntentService) {}

  private userId(req: { user?: AuthedUser }): number {
    const id = req.user?.id;
    if (typeof id !== 'number') throw new Error('Sign in first (login wall).');
    return id;
  }

  @Post('deposit/challenge')
  @UseGuards(AuthGuard)
  @UseInterceptors(AuditInterceptor)
  @Audit('vault.deposit_challenge')
  async depositChallenge(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(DepositChallengeDto, body);
    const data = await this.intents.challenge(
      this.userId(req),
      'DEPOSIT',
      dto.vaultId ?? 1,
      dto.amountSol,
      dto.wallet,
    );
    return { success: true, data };
  }

  @Post('withdraw/challenge')
  @UseGuards(AuthGuard)
  @UseInterceptors(AuditInterceptor)
  @Audit('vault.withdraw_challenge')
  async withdrawChallenge(
    @Body() body: Record<string, unknown>,
    @Req() req: { user?: AuthedUser },
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(WithdrawChallengeDto, body);
    const data = await this.intents.challenge(
      this.userId(req),
      'WITHDRAW',
      dto.vaultId ?? 1,
      dto.shares,
      dto.wallet,
    );
    return { success: true, data };
  }
}
