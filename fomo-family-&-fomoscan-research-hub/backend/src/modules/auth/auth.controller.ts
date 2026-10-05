import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { validateDto } from '../../common/validation/validate-dto.js';
import {
  AuthGuard,
  AuthedUser,
  buildSessionCookie,
  clearSessionCookie,
  extractSessionToken,
} from '../../common/auth/guards.js';
import { AuthService } from './auth.service.js';
import { LoginDto, NonceDto, RegisterDto, VerifyDto } from './dto/auth.dto.js';

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('nonce')
  async nonce(@Body() body: Record<string, unknown>): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(NonceDto, body);
    const data = await this.auth.issueNonce(dto.wallet);
    return { success: true, data };
  }

  @Post('verify')
  async verify(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(VerifyDto, body);
    const data = await this.auth.verify(dto.wallet, dto.signature);
    // Dual transport: raw token in body (scripts/compat) + httpOnly cookie (browsers).
    res.setHeader('Set-Cookie', buildSessionCookie(data.token));
    return { success: true, data };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: { user?: AuthedUser }): Promise<{ success: boolean; data: unknown }> {
    return { success: true, data: req.user ?? null };
  }

  @Post('register')
  async register(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(RegisterDto, body);
    const data = await this.auth.register({ username: dto.username, email: dto.email, password: dto.password });
    res.setHeader('Set-Cookie', buildSessionCookie(data.token));
    return { success: true, data };
  }

  @Post('login')
  async login(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(LoginDto, body);
    const data = await this.auth.login({ username: dto.username, password: dto.password });
    res.setHeader('Set-Cookie', buildSessionCookie(data.token));
    return { success: true, data };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(
    @Req() req: { headers?: Record<string, string | string[] | undefined> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.auth.revoke(extractSessionToken(req));
    res.setHeader('Set-Cookie', clearSessionCookie());
    return { success: true, data };
  }
}
