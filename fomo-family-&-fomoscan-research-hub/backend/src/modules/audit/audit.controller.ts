import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../../common/auth/guards.js';
import { AuditService } from './audit.service.js';

@Controller('api/audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  async list(
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<{ success: boolean; total: number; data: unknown }> {
    const pick = (v: string | string[] | undefined): string | undefined =>
      typeof v === 'string' ? v : undefined;
    const rawLimit = pick(query.limit);
    const parsed = rawLimit !== undefined ? parseInt(rawLimit, 10) : NaN;
    const { total, data } = await this.audit.list({
      actor: pick(query.actor),
      action: pick(query.action),
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
    return { success: true, total, data };
  }
}
