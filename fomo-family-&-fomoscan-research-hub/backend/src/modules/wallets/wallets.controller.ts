import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { validateDto } from '../../common/validation/validate-dto.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { UpdateWalletDto } from './dto/update-wallet.dto.js';
import { WalletsService } from './wallets.service.js';

@Controller('api/wallets')
export class WalletsController {
  constructor(@Inject(WalletsService) private readonly wallets: WalletsService) {}

  @Get()
  async findAll() {
    const data = await this.wallets.findAll();
    return { success: true, total: data.length, data };
  }

  @Post()
  async create(@Body() body: Record<string, unknown>) {
    const dto = await validateDto(CreateWalletDto, body);
    const data = await this.wallets.create(dto);
    return {
      success: true,
      message: `On-chain listening enabled for wallet ${data.address}`,
      data,
    };
  }

  @Delete(':address')
  async remove(@Param('address') address: string) {
    const removed = await this.wallets.remove(address);
    if (!removed) {
      throw new NotFoundException({ success: false, message: 'Wallet not found.' });
    }
    return { success: true, message: `Wallet ${address} removed` };
  }

  @Patch(':address')
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
}
