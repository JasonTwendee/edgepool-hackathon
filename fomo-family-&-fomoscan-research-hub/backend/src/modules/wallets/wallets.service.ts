import { BadRequestException, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  DEFAULT_TRACKED_WALLETS,
  SolanaOnChainListenerService,
} from '../../server/solana.service.js';
import { SolanaStreamService } from '../../server/solana-stream.service.js';
import {
  toTrackedWallet,
  type TrackedWallet,
} from './entities/tracked-wallet.entity.js';
import type { CreateWalletDto } from './dto/create-wallet.dto.js';
import type { UpdateWalletDto } from './dto/update-wallet.dto.js';

/**
 * Wallets CRUD — Postgres (reference schema `tracked_wallets`) is source of
 * truth; the in-memory listener Map is synced so polling/portfolio/SSE run unchanged.
 * Seeds 10 master wallets on empty table (mapped from DEFAULT_TRACKED_WALLETS).
 * DELETE cascades to transactions + realtime_events (FK ON DELETE CASCADE).
 */
@Injectable()
export class WalletsService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SolanaOnChainListenerService)
    private readonly solana: SolanaOnChainListenerService,
    @Inject(SolanaStreamService) private readonly stream: SolanaStreamService,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((await this.prisma.trackedWallet.count()) === 0) {
      await this.prisma.trackedWallet.createMany({
        data: DEFAULT_TRACKED_WALLETS.map((w) => ({
          address: w.address,
          label: w.label,
          handle: w.handle,
          avatarUrl: w.avatar ?? null,
          allocationWeight: w.allocationWeight,
          isActive: w.isCopyEnabled,
          winRate: w.winRate,
          cumulativePnlUsd: w.totalPnlUsd,
        })),
        skipDuplicates: true,
      });
    }
    const all = await this.prisma.trackedWallet.findMany({ orderBy: { id: 'asc' } });
    for (const w of all) this.solana.addTrackedWallet(toTrackedWallet(w));
  }

  async findAll(): Promise<TrackedWallet[]> {
    const all = await this.prisma.trackedWallet.findMany({ orderBy: { id: 'asc' } });
    return all.map(toTrackedWallet);
  }

  async findByAddress(address: string): Promise<TrackedWallet | null> {
    const e = await this.prisma.trackedWallet.findUnique({ where: { address } });
    return e ? toTrackedWallet(e) : null;
  }

  async create(dto: CreateWalletDto): Promise<TrackedWallet> {
    if (!dto.address || typeof dto.address !== 'string') {
      throw new BadRequestException({
        success: false,
        message: 'Địa chỉ ví Solana không được để trống.',
      });
    }
    const address = dto.address.trim();
    try {
      new PublicKey(address);
    } catch {
      throw new BadRequestException({
        success: false,
        message: `Địa chỉ ví Solana không hợp lệ: ${address}`,
      });
    }
    // upsert = giữ semantics cũ của Map.set (ghi đè khi trùng address)
    const saved = await this.prisma.trackedWallet.upsert({
      where: { address },
      update: {
        label: dto.label || 'Custom Trader',
        handle: dto.handle || address.slice(0, 6),
        allocationWeight: dto.allocationWeight ?? 1.0,
        isActive: true,
      },
      create: {
        address,
        label: dto.label || 'Custom Trader',
        handle: dto.handle || address.slice(0, 6),
        allocationWeight: dto.allocationWeight ?? 1.0,
        isActive: true,
        totalTradesCount: 0,
        // No fake defaults: PnL/winRate stay null until real pairs are computed.
        cumulativePnlUsd: null,
        winRate: null,
      },
    });
    const result = toTrackedWallet(saved);
    this.solana.addTrackedWallet(result);
    await this.stream.watch(address);
    return result;
  }

  async remove(address: string): Promise<boolean> {
    const result = await this.prisma.trackedWallet.deleteMany({ where: { address } });
    this.solana.removeTrackedWallet(address);
    await this.stream.unwatch(address);
    return result.count > 0;
  }

  async updateCopyConfig(address: string, dto: UpdateWalletDto): Promise<boolean> {
    const existing = await this.prisma.trackedWallet.findUnique({ where: { address } });
    if (!existing) return false;
    const updated = await this.prisma.trackedWallet.update({
      where: { address },
      data: {
        isActive: dto.isCopyEnabled ?? existing.isActive,
        allocationWeight: dto.allocationWeight ?? existing.allocationWeight.toNumber(),
      },
    });
    this.solana.updateWalletCopyConfig(
      address,
      updated.isActive,
      updated.allocationWeight.toNumber(),
    );
    return true;
  }
}
