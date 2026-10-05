import { Body, Controller, Get, Inject, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { BotsService } from './bots.service.js';
import { CreateBotDto, SetBotModeDto } from './dto/bots.dto.js';

const ENV = 'sandbox';

@Controller('api/bots')
export class BotsController {
  constructor(@Inject(BotsService) private readonly bots: BotsService) {}

  @Get()
  async list(): Promise<{ success: boolean; total: number; data: unknown }> {
    const data = (await this.bots.list()) as Record<string, unknown>[];
    return { success: true, total: data.length, data: data.map((b) => ({ ...b, environment: ENV })) };
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('bot.create')
  async create(@Body() body: Record<string, unknown>): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(CreateBotDto, body);
    const data = (await this.bots.create(dto.name, dto.vaultId)) as Record<string, unknown>;
    return { success: true, data: { ...data, environment: ENV } };
  }

  @Post(':id/mode')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('bot.set_mode')
  async setMode(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ success: boolean; data: unknown }> {
    const parsed = parseInt(id, 10);
    const dto = await validateDto(SetBotModeDto, body);
    const data = (await this.bots.setMode(Number.isFinite(parsed) ? parsed : -1, dto.mode)) as Record<
      string,
      unknown
    >;
    return { success: true, data: { ...data, environment: ENV } };
  }
}
