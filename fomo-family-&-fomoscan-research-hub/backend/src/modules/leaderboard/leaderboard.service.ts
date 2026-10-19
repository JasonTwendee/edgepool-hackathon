import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { FomoscanService } from '../../common/fomoscan/fomoscan.service.js';
import { decodeWalletAddress } from '../../common/auth/solana-verify.js';
import { SolanaOnChainListenerService } from '../../server/solana.service.js';
import { SolanaStreamService } from '../../server/solana-stream.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toTrackedWallet } from '../wallets/entities/tracked-wallet.entity.js';

/**
 * Leaderboard rotation (fomoscan topic): tracked wallets follow the verified
 * FomoScan leaderboard instead of manual add/remove.
 * - Top N (LEADERBOARD_TOP_N=20) → ACTIVE (create/reactivate, best-effort enrich).
 * - Active wallets outside top N → isActive=false. History + orders are KEPT.
 * - Total rows past LEADERBOARD_CAP=50 → oldest INACTIVE pruned (cascade tx).
 * - Cash-out rule: no forced exit. Dropped wallets stop syncing (no fresh
 *   signals); open positions stay managed to natural close via manage tick.
 * Manual tick() doubles as the ADMIN test hook; the interval loop is the
 * production path (LEADERBOARD_SYNC_INTERVAL_MS, default 24h, `0` = manual only).
 */
export const DEFAULT_TOP_N = 20;
/** Unified 20-wallet universe (user-confirmed 2026-10-06): top 20 active, max 20 rows. */
export const DEFAULT_CAP = 20;
export const DEFAULT_PERIOD = 'weekly';
export const DEFAULT_INTERVAL_MS = 86400000;

export interface RotationSummary {
  period: string;
  topN: number;
  cap: number;
  added: number;
  reactivated: number;
  deactivated: number;
  pruned: number;
  total: number;
  active: number;
  at: string;
  note?: string;
}

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v >= 0 ? v : fallback;
}

@Injectable()
export class LeaderboardService implements OnModuleInit {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FomoscanService) private readonly fomoscan: FomoscanService,
    @Inject(SolanaOnChainListenerService) private readonly listener: SolanaOnChainListenerService,
    @Inject(SolanaStreamService) private readonly stream: SolanaStreamService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const ms = Number(process.env.LEADERBOARD_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    // Boot tick (non-blocking): fill the 20-wallet universe immediately instead
    // of waiting up to 24h for the first interval fire. Never crashes boot.
    void this.tick()
      .then((s) => {
        // eslint-disable-next-line no-console
        console.log(`[leaderboard] boot tick: added=${s.added} active=${s.active} total=${s.total}`);
      })
      .catch((e: unknown) => {
        console.warn('[leaderboard] boot tick failed:', (e as Error).message);
      });
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e: unknown) => {
        console.warn('[leaderboard] loop tick failed:', (e as Error).message);
      });
    }, ms);
    this.timer.unref?.();
  }

  async status(): Promise<{ period: string; topN: number; cap: number; total: number; active: number }> {
    const [total, active] = await Promise.all([
      this.prisma.trackedWallet.count(),
      this.prisma.trackedWallet.count({ where: { isActive: true } }),
    ]);
    return {
      period: process.env.LEADERBOARD_PERIOD || DEFAULT_PERIOD,
      topN: intEnv('LEADERBOARD_TOP_N', DEFAULT_TOP_N),
      cap: intEnv('LEADERBOARD_CAP', DEFAULT_CAP),
      total,
      active,
    };
  }

  async tick(): Promise<RotationSummary> {
    // Overlap guard: rotation cascade trên DB 5M+ rows có thể chạy hàng chục
    // phút — tick chồng tick là nguyên nhân pileup DELETE (sập API 19/10).
    if (this.running) {
      console.warn('[leaderboard] tick skipped (previous tick still running)');
      return {
        period: process.env.LEADERBOARD_PERIOD || DEFAULT_PERIOD,
        topN: 0,
        cap: 0,
        added: 0,
        reactivated: 0,
        deactivated: 0,
        pruned: 0,
        total: 0,
        active: 0,
        at: new Date().toISOString(),
        note: 'concurrent-tick-skipped',
      };
    }
    this.running = true;
    try {
      return await this.tickInner();
    } finally {
      this.running = false;
    }
  }

  private async tickInner(): Promise<RotationSummary> {
    const period = process.env.LEADERBOARD_PERIOD || DEFAULT_PERIOD;
    const topN = Math.max(intEnv('LEADERBOARD_TOP_N', DEFAULT_TOP_N), 1);
    const cap = Math.max(intEnv('LEADERBOARD_CAP', DEFAULT_CAP), topN);
    // Over-fetch, then filter, then slice: guarantees topN *Solana* traders
    // even when the raw board mixes chains/unverified entries.
    const fetchN = Math.min(100, Math.max(cap, topN * 3));
    const lb = await this.fomoscan.leaderboard(fetchN, period as 'daily' | 'weekly' | 'monthly');
    // Solana-only: the pump leaderboard should be Solana wallets, but guard
    // anyway — skip entries without a valid 32-byte Solana address or unverified.
    const usable = lb.entries.filter((e) => {
      if (!e.isVerified) return false;
      try {
        decodeWalletAddress(e.wallet);
        return true;
      } catch {
        return false;
      }
    });
    const top = usable.slice(0, topN);
    const topSet = new Set(top.map((e) => e.wallet));

    let added = 0;
    let reactivated = 0;
    for (const e of top) {
      const existing = await this.prisma.trackedWallet.findUnique({ where: { address: e.wallet } });
      const snapshot = {
        fomoPnlUsd: e.pnlUsd,
        fomoRank: e.rank,
        fomoSyncedAt: new Date(),
      };
      if (!existing) {
        await this.prisma.trackedWallet.create({
          data: {
            address: e.wallet,
            label: e.username,
            handle: e.username,
            allocationWeight: 1.0,
            isActive: true,
            totalTradesCount: 0,
            ...snapshot,
          },
        });
        added++;
      } else {
        await this.prisma.trackedWallet.update({
          where: { address: e.wallet },
          data: {
            ...(existing.isActive ? {} : { isActive: true, label: e.username, handle: e.username }),
            ...snapshot,
          },
        });
        if (!existing.isActive) reactivated++;
      }
      // Best-effort enrich (unknown wallets simply stay unenriched).
      // Skip wallets that already have an avatar — identity rarely changes and
      // each lookup burns sponsor credits (was: re-enriched every tick).
      if (!existing?.avatarUrl) {
        try {
          const idn = await this.fomoscan.lookupWallet(e.wallet);
          await this.prisma.trackedWallet.update({
            where: { address: e.wallet },
            data: {
              avatarUrl: idn.profilePicture ?? undefined,
              bio: idn.bio ?? undefined,
              evmAddress: idn.evmAddress ?? undefined,
            },
          });
        } catch {
          // enrich is cosmetic — rotation must not fail on it.
        }
      }
    }

    let deactivated = 0;
    const actives = await this.prisma.trackedWallet.findMany({ where: { isActive: true } });
    for (const w of actives) {
      if (!topSet.has(w.address)) {
        await this.prisma.trackedWallet.update({ where: { address: w.address }, data: { isActive: false } });
        this.listener.removeTrackedWallet(w.address);
        await this.stream.unwatch(w.address).catch(() => undefined);
        deactivated++;
      }
    }

    // Live-wire the new actives into the listener registry + WS stream so
    // fresh swaps arrive without waiting for a backend restart.
    for (const e of top) {
      const row = await this.prisma.trackedWallet.findUnique({ where: { address: e.wallet } });
      if (row?.isActive) {
        this.listener.addTrackedWallet(toTrackedWallet(row));
        await this.stream.watch(e.wallet).catch(() => undefined);
      }
    }

    // Fix 11 — guarded cap prune. Victims are INACTIVE only (existing rule)
    // AND carry no live references: no open copy orders (CopyOrder keeps a
    // plain-string masterWallet, so deleting the wallet would silently orphan
    // join context) and no ACTIVE vaultTrader membership (cascade would also
    // wipe the wallet's transactions + realtime events via FK). One audit row
    // per tick names the victims; audit failure never blocks rotation.
    let pruned = 0;
    const total = await this.prisma.trackedWallet.count();
    if (total > cap) {
      const candidates = await this.prisma.trackedWallet.findMany({
        where: { isActive: false },
        orderBy: { id: 'asc' },
        take: total - cap,
      });
      const [openOrders, activeTraders] = await Promise.all([
        this.prisma.copyOrder.findMany({ where: { closedAt: null }, select: { masterWallet: true } }),
        this.prisma.vaultTrader.findMany({ where: { isActive: true }, select: { wallet: true } }),
      ]);
      const liveWallets = new Set([
        ...openOrders.map((o) => o.masterWallet as string),
        ...activeTraders.map((t) => t.wallet as string),
      ]);
      const victims = candidates.filter((v) => !liveWallets.has(v.address));
      if (victims.length > 0) {
        // Deactivate-only rule: ví có lịch sử KHÔNG BAO GIỜ bị xóa cứng —
        // cascade FK sẽ cuốn cả trăm nghìn transactions + realtime events
        // (sập API 19/10: DELETE 36 ví kẹt 100+ phút trên VPS 2GB).
        // Chỉ xóa ví trắng (0 txns); còn lại giữ INACTIVE + history.
        const withTx = new Set(
          (
            await this.prisma.transaction.groupBy({
              by: ['walletAddress'],
              where: { walletAddress: { in: victims.map((v) => v.address) } },
              _count: true,
            })
          ).map((g) => g.walletAddress),
        );
        const deletable = victims.filter((v) => !withTx.has(v.address));
        const kept = victims.length - deletable.length;
        if (kept > 0) {
          console.warn(
            `[leaderboard] cap ${cap}/${total}: kept ${kept} inactive wallets WITH history (never hard-delete)`,
          );
        }
        if (deletable.length === 0) {
          console.warn(
            `[leaderboard] cap ${cap}/${total}: all ${victims.length} excess wallets carry history, pruned 0`,
          );
        } else {
          const gone = await this.prisma.trackedWallet.deleteMany({
            where: { id: { in: deletable.map((v) => v.id) } },
          });
        pruned = gone.count;
        // Pruned wallets must leave the live pipeline too — otherwise their
        // WS subs + poll slots keep burning RPC after the DB row is gone.
        // (Chỉ deletable: ví giữ lại đã INACTIVE sẵn, reconcile cuối tick
        // dọn nốt nếu còn sót trong listener.)
        for (const v of deletable) {
          this.listener.removeTrackedWallet(v.address);
          await this.stream.unwatch(v.address).catch(() => undefined);
        }
        await this.audit
          .record({
            actor: 'system:rotation',
            action: 'wallet.rotation_prune',
            target: deletable.map((v) => v.address).join(',').slice(0, 200),
            reason: `cap ${cap}/${total}: pruned ${pruned} empty wallets, kept ${kept} with history`,
          })
          .catch((e: unknown) => {
            console.warn('[leaderboard] prune audit failed:', (e as Error).message);
          });
        }
      } else if (candidates.length > 0) {
        console.warn(`[leaderboard] cap ${cap}/${total}: ${candidates.length} excess wallets all live-referenced, pruned 0`);
      }
    }

    const [finalTotal, finalActive] = await Promise.all([
      this.prisma.trackedWallet.count(),
      this.prisma.trackedWallet.count({ where: { isActive: true } }),
    ]);
    // Reconcile live pipeline with DB truth: the listener registry is seeded
    // with hardcoded defaults at construction and drifts (deactivations,
    // prunes) — anything subscribed but not DB-active burns RPC for nothing.
    const dbActives = await this.prisma.trackedWallet.findMany({
      where: { isActive: true },
      select: { address: true },
    });
    const dbActiveSet = new Set(dbActives.map((w) => w.address));
    for (const w of this.listener.getTrackedWallets()) {
      if (!dbActiveSet.has(w.address)) {
        this.listener.removeTrackedWallet(w.address);
        await this.stream.unwatch(w.address).catch(() => undefined);
      }
    }
    // Window ranks for the pool basket display (Rank · 24h/7d/30d): snapshot
    // each FomoScan window independently of rotation membership. Reuses the
    // main board when the period matches to save a call. Never creates rows
    // (rotation owns membership) and never fails the tick.
    const rankWindows = [
      ['daily', 'rank24h'],
      ['weekly', 'rank7d'],
      ['monthly', 'rank30d'],
    ] as const;
    const rankByWallet = new Map<string, { rank24h?: number; rank7d?: number; rank30d?: number }>();
    for (const [win, col] of rankWindows) {
      let board: { entries: { wallet: string; isVerified: boolean; rank?: unknown }[] } | null =
        win === period ? (lb as unknown as { entries: { wallet: string; isVerified: boolean; rank?: unknown }[] }) : null;
      if (!board) {
        try {
          board = (await this.fomoscan.leaderboard(fetchN, win)) as unknown as {
            entries: { wallet: string; isVerified: boolean; rank?: unknown }[];
          };
        } catch {
          continue;
        }
      }
      for (const e of board.entries) {
        if (!e.isVerified) continue;
        try {
          decodeWalletAddress(e.wallet);
        } catch {
          continue;
        }
        if (typeof e.rank !== 'number') continue;
        const cur = rankByWallet.get(e.wallet) ?? {};
        (cur as Record<string, number>)[col] = e.rank;
        rankByWallet.set(e.wallet, cur);
      }
    }
    for (const [wallet, ranks] of rankByWallet) {
      try {
        const existing = await this.prisma.trackedWallet.findUnique({ where: { address: wallet } });
        if (!existing) continue;
        await this.prisma.trackedWallet.update({ where: { address: wallet }, data: { ...ranks } });
      } catch {
        // rank snapshot is display-only — never break rotation.
      }
    }
    return { period, topN, cap, added, reactivated, deactivated, pruned, total: finalTotal, active: finalActive, at: new Date().toISOString() };
  }
}
