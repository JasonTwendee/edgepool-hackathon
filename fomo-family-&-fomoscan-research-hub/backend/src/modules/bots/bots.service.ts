import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

export const BOT_MODES = ['AUTO', 'PAUSED'] as const;

function fail(message: string): never {
  throw new BadRequestException({ success: false, message });
}

function notFound(message: string): never {
  throw new NotFoundException({ success: false, message });
}

/**
 * Operational bot records (fund spec §4.1, intent D8).
 * Record only — NO execution logic lives here; auto-fire engine is a later phase
 * requiring separate approval for `copy-trade/**`.
 */
@Injectable()
export class BotsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(): Promise<unknown[]> {
    return this.prisma.bot.findMany({ orderBy: { id: 'asc' } });
  }

  async create(name: string, vaultId?: number): Promise<unknown> {
    const clean = (name ?? '').trim();
    if (clean.length < 2) fail('Bot name is required.');
    if (vaultId !== undefined) {
      const vault = await this.prisma.vault.findUnique({ where: { id: vaultId } });
      if (!vault) notFound(`Vault ${vaultId} not found.`);
    }
    try {
      return await this.prisma.bot.create({
        data: { name: clean, vaultId: vaultId ?? null, mode: 'AUTO', status: 'IDLE' },
      });
    } catch {
      fail(`Bot name already exists: ${clean}.`);
    }
  }

  async setMode(id: number, mode: string): Promise<unknown> {
    if (!BOT_MODES.includes(mode as (typeof BOT_MODES)[number])) {
      fail(`Invalid mode: ${mode}. Allowed: ${BOT_MODES.join(',')}.`);
    }
    const existing = await this.prisma.bot.findUnique({ where: { id } });
    if (!existing) notFound(`Bot ${id} not found.`);
    return this.prisma.bot.update({ where: { id }, data: { mode } });
  }
}
