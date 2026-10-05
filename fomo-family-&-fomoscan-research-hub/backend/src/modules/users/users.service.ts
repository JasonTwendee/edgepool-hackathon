import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { decodeWalletAddress } from '../../common/auth/solana-verify.js';

export const USER_ROLES = ['USER', 'KOL', 'ADMIN'] as const;

export interface FundIdentity {
  id: number;
  wallet: string;
  role: string;
  username: string | null;
  email: string | null;
}

function toIdentity(r: {
  id: number;
  wallet: string;
  role: string;
  username?: string | null;
  email?: string | null;
}): FundIdentity {
  return { id: r.id, wallet: r.wallet, role: r.role, username: r.username ?? null, email: r.email ?? null };
}

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
      fail(`Invalid Solana wallet address: ${wallet}`);
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

  async list(): Promise<FundIdentity[]> {
    const rows = await this.prisma.user.findMany({ orderBy: { id: 'asc' } });
    return rows.map((r) => toIdentity(r));
  }

  /**
   * Resolve an identity for role changes. Accepts (in order):
   * 1. exact wallet match (Base58 wallets AND `cred:<username>` credential wallets),
   * 2. bare credential username (e.g. `kol_01` → wallet `cred:kol_01`).
   * Wallet-shape validation is intentionally NOT required here so ADMIN can
   * manage credential accounts created via POST /api/auth/register.
   */
  async setRole(identity: string, role: string): Promise<FundIdentity> {
    if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
      fail(`Invalid role: ${role}. Allowed: ${USER_ROLES.join(',')}.`);
    }
    const clean = (identity ?? '').trim();
    let existing = clean ? await this.prisma.user.findUnique({ where: { wallet: clean } }) : null;
    if (!existing && clean) {
      existing = await this.prisma.user.findUnique({ where: { username: clean } });
    }
    if (!existing) notFound(`User not found: ${clean}.`);
    const updated = await this.prisma.user.update({ where: { id: existing.id }, data: { role } });
    return toIdentity(updated);
  }

  async countAdmins(): Promise<number> {
    return this.prisma.user.count({ where: { role: 'ADMIN' } });
  }
}
