import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  FomoscanService,
  type FomoscanPnl,
  type LeaderboardEntry,
} from '../../common/fomoscan/fomoscan.service.js';
import { decodeWalletAddress } from '../../common/auth/solana-verify.js';
import { SolanaOnChainListenerService } from '../../server/solana.service.js';
import { SolanaStreamService } from '../../server/solana-stream.service.js';
import { AuditService } from '../audit/audit.service.js';
import { toTrackedWallet } from '../wallets/entities/tracked-wallet.entity.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { resolveLiveScope } from '../../common/live-scope.js';
import {
  buildSelectionSnapshot,
  hashSelectionSnapshot,
  type SelectionSnapshot,
} from '../../common/fomoscan/selection-snapshot.js';

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
export const DEFAULT_TOP_N = 5;
/** History rows are kept for inactive wallets; cap only limits total tracked rows. */
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

/**
 * Deterministic top-N roster selection: 24h rank first, then 7d/30d, then
 * cumulative PnL, then address. Missing ranks sort last (never win a slot).
 */
export function pickRoster(
  rows: Array<{
    address: string;
    rank24h?: number | null;
    rank7d?: number | null;
    rank30d?: number | null;
    cumulativePnlUsd?: unknown;
  }>,
  n = 5,
): string[] {
  const rank = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  const pnl = (v: unknown): number => {
    if (v && typeof v === 'object' && 'toNumber' in (v as object)) {
      try {
        return (v as { toNumber(): number }).toNumber();
      } catch {
        return 0;
      }
    }
    const num = Number(v ?? 0);
    return Number.isFinite(num) ? num : 0;
  };
  return [...rows]
    .sort(
      (a, b) =>
        rank(a.rank24h) - rank(b.rank24h) ||
        rank(a.rank7d) - rank(b.rank7d) ||
        rank(a.rank30d) - rank(b.rank30d) ||
        pnl(b.cumulativePnlUsd) - pnl(a.cumulativePnlUsd) ||
        a.address.localeCompare(b.address),
    )
    .slice(0, Math.max(n, 1))
    .map((r) => r.address);
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
    @Inject(WalletsService) private readonly wallets: WalletsService,
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
    // Pool roster is the live set. It may contain wallets outside the current
    // topN display universe; those stay active and must never be deactivated
    // or unsubscribed by rotation.
    const live = await resolveLiveScope(this.prisma);
    const liveSet = live.mode === 'pool' ? live.addresses : null;
    const rosterMode = process.env.LIVE_ROSTER_MODE ?? 'pin';
    // In normal pool mode the display universe IS the live roster. Do not
    // activate unrelated board wallets: they would show up in status/counts
    // and create a second, non-live set. `top` mode keeps board-driven churn.
    const liveOnly = Boolean(liveSet) && rosterMode !== 'top';
    const activationTop = liveOnly ? top.filter((e) => liveSet?.has(e.wallet)) : top;
    const topSet = new Set(activationTop.map((e) => e.wallet));

    let added = 0;
    let reactivated = 0;
    for (const e of activationTop) {
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

    // Pin live pool traders active before deactivation so a wallet that fell
    // out of the topN display board is not silently dropped from ingestion.
    if (liveSet && liveSet.size > 0) {
      await this.prisma.trackedWallet.updateMany({
        where: { address: { in: [...liveSet] }, isActive: false },
        data: { isActive: true },
      });
    }

    let deactivated = 0;
    const actives = await this.prisma.trackedWallet.findMany({ where: { isActive: true } });
    for (const w of actives) {
      if (!topSet.has(w.address) && !(liveSet?.has(w.address))) {
        await this.prisma.trackedWallet.update({ where: { address: w.address }, data: { isActive: false } });
        this.listener.removeTrackedWallet(w.address);
        await this.stream.unwatch(w.address).catch(() => undefined);
        deactivated++;
      }
    }

    // Live-wiring is done once in the final reconcile below: it targets the
    // live scope (or DB actives in legacy/all mode) and calls resetTo, so
    // rotation can never re-subscribe the whole display board.

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
    // Reconcile the live pipeline with the live scope (or DB truth in legacy
    // all mode). resetTo is authoritative: anything outside the target is
    // unsubscribed immediately, and the registry is pruned to the same set.
    const targetRows = await this.prisma.trackedWallet.findMany({
      where: liveSet ? { address: { in: [...liveSet] } } : { isActive: true },
    });
    const targetSet = new Set(targetRows.map((w) => w.address));
    if (liveSet && targetSet.size < liveSet.size) {
      const missing = [...liveSet].filter((a) => !targetSet.has(a));
      console.warn(`[leaderboard] live traders missing from tracked_wallets: ${missing.length}`);
    }
    for (const row of targetRows) this.listener.addTrackedWallet(toTrackedWallet(row));
    for (const w of this.listener.getTrackedWallets()) {
      if (!targetSet.has(w.address)) {
        this.listener.removeTrackedWallet(w.address);
        await this.stream.unwatch(w.address).catch(() => undefined);
      }
    }
    await this.stream.resetTo([...targetSet]).catch(() => undefined);
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
    // Keep both public pools on the same roster. Default `pin` re-picks the
    // best 5 from the current union (idempotent); `top` takes the live board
    // top 5 and persists a Fomo selection snapshot for every new term.
    if (liveSet) {
      if (rosterMode === 'top') {
        const picks = top.slice(0, 5);
        if (picks.length < 5) {
          console.warn(`[leaderboard] top roster skipped: only ${picks.length} verified candidate(s)`);
          await this.audit
            .record({
              actor: 'system:rotation',
              action: 'rotation.fomo_unavailable',
              target: 'top5',
              reason: `only ${picks.length} verified candidates; keeping previous roster`,
            })
            .catch(() => undefined);
        } else {
          const snapshots = await this.buildSelectionSnapshots(picks, period);
          await this.syncPublicPoolRosters(
            picks.map((e) => e.wallet),
            snapshots,
          ).catch((e: unknown) => {
            console.warn('[leaderboard] roster sync failed:', (e as Error).message);
          });
        }
      } else {
        await this.syncPublicPoolRosters().catch((e: unknown) => {
          console.warn('[leaderboard] roster sync failed:', (e as Error).message);
        });
      }
      // Legacy/current members may predate entrySnapshot. Fill their “why top”
      // snapshot from Fomo without changing enteredAt.
      await this.ensureEntrySnapshots(liveSet, top, period).catch((e: unknown) => {
        console.warn('[leaderboard] entry snapshot backfill failed:', (e as Error).message);
      });
      // Make the new roster live immediately (WS + listener registry), instead
      // of waiting up to 60s for the WalletsService interval.
      await this.wallets.reconcileLiveStream().catch((e: unknown) => {
        console.warn('[leaderboard] live-scope reconcile failed:', (e as Error).message);
      });
    }

    return { period, topN, cap, added, reactivated, deactivated, pruned, total: finalTotal, active: finalActive, at: new Date().toISOString() };
  }

  /** Fetch Fomo “why top” metrics for the selected board (best-effort per row). */
  private async buildSelectionSnapshots(
    entries: LeaderboardEntry[],
    period: string,
  ): Promise<Map<string, SelectionSnapshot>> {
    const fetchedAt = new Date();
    const out = new Map<string, SelectionSnapshot>();
    for (const entry of entries) {
      let pnl: FomoscanPnl | null = null;
      try {
        if (entry.username) pnl = await this.fomoscan.getPnl(entry.username);
      } catch {
        // Board metrics are enough to rotate; snapshot keeps pnl null.
      }
      out.set(entry.wallet, buildSelectionSnapshot(entry, pnl, period, fetchedAt));
    }
    return out;
  }

  /**
   * Backfill entrySnapshot for current members created before this feature
   * (or manually assigned). Never changes enteredAt/weights.
   */
  private async ensureEntrySnapshots(
    liveSet: Set<string>,
    board: LeaderboardEntry[],
    period: string,
  ): Promise<void> {
    const rows = await this.prisma.vaultTrader.findMany({
      where: {
        isActive: true,
        vault: { listing: 'public', status: 'live' },
      },
      select: { wallet: true, entrySnapshot: true },
    });
    const missing = [
      ...new Set(
        rows
          .filter((r) => !r.entrySnapshot && liveSet.has(r.wallet))
          .map((r) => r.wallet),
      ),
    ];
    if (missing.length === 0) return;
    const fetchedAt = new Date();
    for (const wallet of missing) {
      const boardEntry = board.find((e) => e.wallet === wallet);
      const tracked = boardEntry ? null : await this.prisma.trackedWallet.findUnique({ where: { address: wallet } });
      const entry: LeaderboardEntry = boardEntry ?? {
        rank: (tracked?.fomoRank as number | null) ?? 0,
        wallet,
        username: (tracked?.handle as string | null) ?? wallet.slice(0, 6),
        isVerified: true,
        pnlSol: 0,
        pnlUsd: Number(tracked?.fomoPnlUsd ?? 0),
        pnlPercent: 0,
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
      };
      let pnl: FomoscanPnl | null = null;
      try {
        pnl = await this.fomoscan.getPnl(entry.username);
      } catch {
        // board-only snapshot is still useful
      }
      const snapshot = buildSelectionSnapshot(entry, pnl, period, fetchedAt);
      await this.prisma.vaultTrader.updateMany({
        where: { wallet, isActive: true },
        data: { entrySnapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
    }
  }

  /**
   * Enforce one shared 5-wallet basket across all public/live pools.
   * - `boardTop` provided (`LIVE_ROSTER_MODE=top`): use those wallets.
   * - otherwise (`pin`): rank the current active union and keep the best 5.
   * New/reactivated members start a new forward-only term (`enteredAt=now`).
   * Equal weights (10000 / n) and `max_traders = n`.
   */
  private async syncPublicPoolRosters(
    boardTop?: string[],
    snapshots?: Map<string, SelectionSnapshot>,
  ): Promise<void> {
    const pools = await this.prisma.vault.findMany({
      where: { listing: 'public', status: 'live' },
      select: { id: true },
    });
    if (pools.length === 0) return;
    const ids = pools.map((p) => p.id);
    const currentRows = await this.prisma.vaultTrader.findMany({
      where: { vaultId: { in: ids } },
    });
    const currentByKey = new Map(currentRows.map((t) => [`${t.vaultId}:${t.wallet}`, t]));

    let picks: string[];
    if (boardTop && boardTop.length >= 5) {
      picks = boardTop.slice(0, 5);
    } else {
      const addresses = [
        ...new Set(currentRows.filter((t) => t.isActive).map((t) => t.wallet)),
      ];
      if (addresses.length < 5) {
        console.warn(`[leaderboard] roster sync skipped: only ${addresses.length} active pool trader(s)`);
        return;
      }
      const rows = await this.prisma.trackedWallet.findMany({
        where: { address: { in: addresses } },
      });
      picks = pickRoster(rows, 5);
    }
    if (picks.length < 5) {
      console.warn(`[leaderboard] roster sync skipped: only ${picks.length} tracked candidate(s)`);
      return;
    }

    const weightBps = Math.floor(10000 / picks.length);
    const now = new Date();
    for (const vaultId of ids) {
      for (const wallet of picks) {
        const existing = currentByKey.get(`${vaultId}:${wallet}`);
        const newTerm = !existing || !existing.isActive || !existing.enteredAt;
        const snapshot = snapshots?.get(wallet) ?? null;
        const snapshotJson = snapshot
          ? (snapshot as unknown as Prisma.InputJsonValue)
          : undefined;
        await this.prisma.vaultTrader.upsert({
          where: { vaultId_wallet: { vaultId, wallet } },
          create: {
            vaultId,
            wallet,
            weightBps,
            isActive: true,
            enteredAt: now,
            entrySnapshot: snapshotJson,
          },
          update: {
            weightBps,
            isActive: true,
            ...(newTerm
              ? {
                  enteredAt: now,
                  exitedAt: null,
                  exitReason: null,
                  entrySnapshot: snapshotJson ?? Prisma.DbNull,
                }
              : {}),
            ...(!newTerm && !existing?.entrySnapshot && snapshotJson
              ? { entrySnapshot: snapshotJson }
              : {}),
          },
        });
      }
      await this.prisma.vaultTrader.updateMany({
        where: { vaultId, isActive: true, wallet: { notIn: picks } },
        data: { isActive: false, exitedAt: now, exitReason: 'rotation' },
      });
    }
    await this.prisma.trackedWallet.updateMany({
      where: { address: { in: picks }, isActive: false },
      data: { isActive: true },
    });
    await this.prisma.vault.updateMany({
      where: { id: { in: ids } },
      data: { maxTraders: picks.length },
    });
    const snapshotHash = snapshots
      ? [...snapshots.values()].map((s) => hashSelectionSnapshot(s)).join(',')
      : '';
    await this.audit
      .record({
        actor: 'system:rotation',
        action: 'pool.roster_sync',
        target: picks.join(',').slice(0, 200),
        reason: `${picks.length} shared traders across ${ids.length} public pool(s), weight ${weightBps}bps${snapshotHash ? `, fomo ${snapshotHash.slice(0, 16)}…` : ''}`,
      })
      .catch((e: unknown) => {
        console.warn('[leaderboard] roster audit failed:', (e as Error).message);
      });
    // eslint-disable-next-line no-console
    console.log(
      `[leaderboard] roster synced: ${picks.length} wallets across ${ids.length} pools${snapshots ? `, fomo snapshots=${snapshots.size}` : ''}`,
    );
  }
}
