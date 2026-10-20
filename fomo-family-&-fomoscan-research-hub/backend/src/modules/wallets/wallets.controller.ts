import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { AuthGuard, Roles, RolesGuard } from '../../common/auth/guards.js';
import { Audit, AuditInterceptor } from '../audit/audit.interceptor.js';
import { UpdateWalletDto } from './dto/update-wallet.dto.js';
import { WalletsService } from './wallets.service.js';

@Controller('api/wallets')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly wallets: WalletsService) {}

  @Get()
  async findAll() {
    // Product surface: only the live pool roster (5 wallets), not the wider
    // rotation/display history. Internal jobs use findAll()/findAllLive().
    const data = await this.wallets.findAllLive();
    return { success: true, total: data.length, data };
  }

  // NOTE: manual add/remove was removed — tracked wallets rotate automatically
  // from the verified leaderboard (leaderboard module). PATCH copy-config stays.

  @Patch(':address')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('wallet.update_copy_config')
  async updateCopyConfig(
    @Param('address') address: string,
    @Body() body: Record<string, unknown>,
  ) {
    const dto = await validateDto(UpdateWalletDto, body);
    const updated = await this.wallets.updateCopyConfig(address, dto);
    if (!updated) {
      throw new NotFoundException({ success: false, message: 'Wallet not found.' });
    }
    return { success: true, message: `Copy config updated for wallet ${address}` };
  }

  @Post(':address/enrich')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(AuditInterceptor)
  @Audit('wallet.enrich')
  async enrich(@Param('address') address: string): Promise<{ success: boolean; data: unknown }> {
    const data = await this.wallets.enrich(address);
    return { success: true, data };
  }
}
