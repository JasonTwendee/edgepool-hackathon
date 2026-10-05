import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { decodeWalletAddress } from '../../common/auth/solana-verify.js';

export const USER_ROLES = ['USER', 'KOL', 'ADMIN'] as const;

function fail(message: string): never {
  throw new BadRequestException({ success: false, message });
}

function notFound(message: string): never {
  throw new NotFoundException({ success: false, message });
}

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  static assertWallet(wallet: string): string {
    const trimmed = (wallet ?? '').trim();
    try {
      decodeWalletAddress(trimmed);
    } catch {
      fail(`Địa chỉ ví Solana không hợp lệ: ${wallet}`);
    }
    return trimmed;
  }

  async findOrCreate(wallet: string): Promise<{ id: number; wallet: string; role: string }> {
    const clean = UsersService.assertWallet(wallet);
    const existing = await this.prisma.user.findUnique({ where: { wallet: clean } });
    if (existing) return { id: existing.id, wallet: existing.wallet, role: existing.role };
    const created = await this.prisma.user.create({ data: { wallet: clean, role: 'USER' } });
    return { id: created.id, wallet: created.wallet, role: created.role };
  }

  async list(): Promise<{ id: number; wallet: string; role: string }[]> {
    const rows = await this.prisma.user.findMany({ orderBy: { id: 'asc' } });
    return rows.map((r) => ({ id: r.id, wallet: r.wallet, role: r.role }));
  }

  async setRole(wallet: string, role: string): Promise<{ id: number; wallet: string; role: string }> {
    const clean = UsersService.assertWallet(wallet);
    if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
      fail(`Role không hợp lệ: ${role}. Cho phép: ${USER_ROLES.join(',')}.`);
    }
    const existing = await this.prisma.user.findUnique({ where: { wallet: clean } });
    if (!existing) notFound(`User không tồn tại: ${clean}.`);
    const updated = await this.prisma.user.update({ where: { wallet: clean }, data: { role } });
    return { id: updated.id, wallet: updated.wallet, role: updated.role };
  }

  async countAdmins(): Promise<number> {
    return this.prisma.user.count({ where: { role: 'ADMIN' } });
  }
}
