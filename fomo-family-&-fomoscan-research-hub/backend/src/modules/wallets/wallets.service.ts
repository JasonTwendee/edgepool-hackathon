import { BadRequestException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
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
import type { UpdateWalletDto } from './dto/update-wallet.dto.js';
import { FomoscanService } from '../../common/fomoscan/fomoscan.service.js';

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
    @Inject(FomoscanService) private readonly fomoscan: FomoscanService,
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

  /**
   * Backfill verified identity (avatar/bio/EVM) from FomoScan for one tracked
   * wallet. Manual ADMIN-only op (controller). Existing local values win when
   * FomoScan returns nulls — enrichment never blanks data.
   */
  async enrich(address: string): Promise<TrackedWallet> {
    const clean = (address ?? '').trim();
    if (!clean) {
      throw new BadRequestException({ success: false, message: 'A wallet address is required.' });
    }
    const existing = await this.prisma.trackedWallet.findUnique({ where: { address: clean } });
    if (!existing) {
      throw new NotFoundException({ success: false, message: `Wallet is not tracked: ${clean}.` });
    }
    let idn;
    try {
      idn = await this.fomoscan.lookupWallet(clean);
    } catch (e) {
      // Unknown to FomoScan (no verified identity) → 404, not 500.
      throw new NotFoundException({
        success: false,
        message: `No verified FomoScan identity for wallet ${clean}.`,
      });
    }
    const updated = await this.prisma.trackedWallet.update({
      where: { address: clean },
      data: {
        avatarUrl: idn.profilePicture ?? existing.avatarUrl,
        bio: idn.bio ?? existing.bio,
        evmAddress: idn.evmAddress ?? existing.evmAddress,
      },
    });
    return toTrackedWallet(updated);
  }
}
