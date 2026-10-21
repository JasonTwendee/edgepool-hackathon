import {
  Controller,
  Inject,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { ChainAdminService } from './chain-admin.service.js';

@Controller('api/chain')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
@UseInterceptors(AuditInterceptor)
export class ChainAdminController {
  constructor(@Inject(ChainAdminService) private readonly admin: ChainAdminService) {}

  /** Create a dedicated unlisted devnet demo pool and initialize its vault. */
  @Post('demo-pool')
  @Audit('chain.demo_pool_create')
  async createDemoPool() {
    return { success: true, data: await this.admin.createDemoPool() };
  }

  /** Bind an existing unlisted demo-chain-* pool to a new devnet vault. */
  @Post('pools/:id/initialize')
  @Audit('chain.pool_initialize')
  async initialize(@Param('id') id: string) {
    const parsed = parseInt(id, 10);
    return { success: true, data: await this.admin.initializePool(parsed) };
  }
}
