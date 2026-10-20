import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { resolveLiveScope } from '../../common/live-scope.js';
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
 * Live pipeline scope = active traders of public/live pools (fallback: DB-active);
 * leaderboard may keep a wider display set without subscribing it.
 * DELETE cascades to transactions + realtime_events (FK ON DELETE CASCADE).
 */
@Injectable()
export class WalletsService implements OnModuleInit, OnModuleDestroy {
  private liveTimer?: NodeJS.Timeout;
  private reconciling = false;
  private lastLiveLog = '';

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
    // The live loop (WS + safety-net sync + stats) follows only the pool
    // roster. Leaderboard rotation may keep a wider DB-active display set.
    await this.reconcileLiveStream().catch((err: unknown) => {
      console.warn('[Wallets] live-scope boot reconcile failed:', (err as Error).message);
    });
    const ms = Number(process.env.LIVE_SCOPE_RECONCILE_MS ?? 60000);
    if (Number.isFinite(ms) && ms > 0) {
      this.liveTimer = setInterval(() => {
        void this.reconcileLiveStream().catch((err: unknown) => {
          console.warn('[Wallets] live-scope reconcile failed:', (err as Error).message);
        });
      }, ms);
      this.liveTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
  }

  /**
   * Wallet set that the live pipeline is allowed to touch. In pool mode this
   * is exactly the active traders of public/live pools; empty roster falls
   * back to DB-active wallets (fresh/dev bootstrap).
   */
  async findAllLive(): Promise<TrackedWallet[]> {
    const scope = await resolveLiveScope(this.prisma);
    if (scope.mode === 'pool') {
      const rows = await this.prisma.trackedWallet.findMany({
        where: { address: { in: [...scope.addresses] } },
        orderBy: { id: 'asc' },
      });
      return rows.map(toTrackedWallet);
    }
    const all = await this.findAll();
    return all.filter((w) => w.isActive !== false);
  }

  /**
   * Reconcile listener registry + WS subscriptions with the live scope.
   * Live pool traders are pinned `isActive=true` so the ingestion guard and
   * sync filter cannot silently drop them when rotation moves on.
   */
  async reconcileLiveStream(): Promise<number> {
    if (this.reconciling) return 0;
    this.reconciling = true;
    try {
      const scope = await resolveLiveScope(this.prisma);
      let rows;
      if (scope.mode === 'pool') {
        const addresses = [...scope.addresses];
        rows = await this.prisma.trackedWallet.findMany({
          where: { address: { in: addresses } },
          orderBy: { id: 'asc' },
        });
        await this.prisma.trackedWallet.updateMany({
          where: { address: { in: addresses }, isActive: false },
          data: { isActive: true },
        });
        const found = new Set(rows.map((r) => r.address));
        const missing = addresses.filter((a) => !found.has(a));
        if (missing.length > 0) {
          console.warn(`[Wallets] ${missing.length} live pool trader(s) not in tracked_wallets — skipped`);
        }
      } else {
        rows = await this.prisma.trackedWallet.findMany({
          where: { isActive: true },
          orderBy: { id: 'asc' },
        });
        console.warn('[Wallets] live scope fallback: no public pool traders — following DB-active wallets');
      }

      const live = rows.map(toTrackedWallet);
      const liveSet = new Set(live.map((w) => w.address));
      for (const w of this.solana.getTrackedWallets()) {
        if (!liveSet.has(w.address)) this.solana.removeTrackedWallet(w.address);
      }
      for (const w of live) this.solana.addTrackedWallet(w);
      await this.stream.resetTo([...liveSet]);
      const signature = `${scope.mode}:${[...liveSet].sort().join(',')}`;
      if (signature !== this.lastLiveLog) {
        this.lastLiveLog = signature;
        // eslint-disable-next-line no-console
        console.log(`[Wallets] live scope=${scope.mode} wallets=${liveSet.size}`);
      }
      return liveSet.size;
    } finally {
      this.reconciling = false;
    }
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
    // The pool roster owns the live subscription set: reconcile instead of
    // ad-hoc watch/unwatch so a manual toggle cannot leak a live slot outside
    // the pool (or drop a live pool trader).
    await this.reconcileLiveStream();
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
