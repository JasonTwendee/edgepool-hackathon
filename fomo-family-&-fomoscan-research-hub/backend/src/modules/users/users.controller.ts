import { Controller, Get, Inject, Param, Post, Body, UseGuards, UseInterceptors } from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, Roles } from '../../common/auth/guards.js';
import { RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { UsersService } from './users.service.js';
import { SetRoleDto } from './dto/users.dto.js';

@Controller('api/users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  async list(): Promise<{ success: boolean; total: number; data: unknown }> {
    const data = await this.users.list();
    return { success: true, total: data.length, data };
  }

  @Post(':wallet/role')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('user.set_role')
  async setRole(
    @Param('wallet') wallet: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ success: boolean; data: unknown }> {
    const dto = await validateDto(SetRoleDto, body);
    const data = await this.users.setRole(wallet, dto.role);
    return { success: true, data: { ...data, environment: 'sandbox' } };
  }
}
