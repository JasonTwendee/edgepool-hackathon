import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface TraderStats {
  wallet: string;
  wins: number;
  losses: number;
  realized: number;
}

export interface ScoredTrader extends TraderStats {
  winRate01: number;
  pnlRank01: number;
  score: number;
  weightBps: number;
}

/** Score bounds (intent D-G1..D-G2). */
export const ALLOC_MIN_BPS = 500;
export const ALLOC_MAX_BPS = 4000;

/**
 * Rank-based allocation scoring (paper track record, 30d closed orders).
 * Neutral when a trader has fewer than 3 closed orders (noise guard).
 */
export function scoreTraders(stats: TraderStats[]): ScoredTrader[] {
  const n = stats.length;
  if (n === 0) return [];
  const withRate = stats.map((s) => {
    const total = s.wins + s.losses;
    return { ...s, winRate01: total >= 3 ? s.wins / total : 0.5 };
  });
  const ranked = [...withRate].sort((a, b) => b.realized - a.realized);
  const rankOf = new Map(ranked.map((s, i) => [s.wallet, n === 1 ? 0.5 : (n - 1 - i) / (n - 1)]));
  const scored = withRate.map((s) => {
    const pnlRank01 = rankOf.get(s.wallet) ?? 0.5;
    return { ...s, winRate01: s.winRate01, pnlRank01, score: 0.6 * s.winRate01 + 0.4 * pnlRank01, weightBps: 0 };
  });
  const total = scored.reduce((s, t) => s + t.score, 0);
  if (total <= 0) {
    const even = Math.floor(10000 / n);
    return scored.map((t, i) => ({ ...t, weightBps: i === 0 ? 10000 - even * (n - 1) : even }));
  }
  // Proportional → clamp to [floor, cap] → fix the sum back to exactly 10000
  // by moving units between in-bounds traders. The 40% cap binds only for
  // n ≥ 3 (2×4000 < 10000 would be infeasible for duos; concentration there
  // is intended).
  const cap = n <= 2 ? 10000 : ALLOC_MAX_BPS;
  const weights = scored.map((t) =>
    Math.min(cap, Math.max(ALLOC_MIN_BPS, Math.round((t.score / total) * 10000))),
  );
  if (n === 1) return scored.map((t) => ({ ...t, weightBps: 10000 }));
  const order = scored.map((t, i) => i).sort((a, b) => scored[b].score - scored[a].score);
  let guard = 0;
  while (guard++ < 100) {
    const sum = weights.reduce((s, w) => s + w, 0);
    const diff = 10000 - sum;
    if (diff === 0) break;
    if (diff > 0) {
      const idx = order.find((i) => weights[i] < cap);
      if (idx === undefined) break;
      weights[idx] = Math.min(cap, weights[idx] + diff);
    } else {
      const idx = [...order].reverse().find((i) => weights[i] > ALLOC_MIN_BPS);
      if (idx === undefined) break;
      weights[idx] = Math.max(ALLOC_MIN_BPS, weights[idx] + diff);
    }
  }
  return scored.map((t, i) => ({ ...t, weightBps: weights[i] }));
}

/**
 * Periodic weight rebalance per vault (manual-first: loop default OFF).
 * Writes VaultTrader.weightBps + audit row. Never touches core gates.
 */
@Injectable()
export class AllocationService implements OnModuleInit {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const ms = Number(process.env.COPY_ALLOC_INTERVAL_MS ?? 0);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      void this.rebalanceAll().catch((e: unknown) => {
        console.warn('[alloc] loop rebalance failed:', (e as Error).message);
      });
    }, ms);
    this.timer.unref?.();
  }

  async rebalanceAll(): Promise<{ vaults: number; updated: number }> {
    const vaults = await this.prisma.vault.findMany({ select: { id: true } });
    let updated = 0;
    for (const v of vaults) {
      const r = await this.rebalance(v.id);
      updated += r.updated;
    }
    return { vaults: vaults.length, updated };
  }

  async rebalance(vaultId: number): Promise<{ vaultId: number; updated: number; weights: { wallet: string; weightBps: number }[] }> {
    const traders = await this.prisma.vaultTrader.findMany({ where: { vaultId, isActive: true } });
    if (traders.length === 0) return { vaultId, updated: 0, weights: [] };
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const closed = await this.prisma.copyOrder.findMany({
      where: {
        masterWallet: { in: traders.map((t) => t.wallet) },
        closedAt: { not: null },
        createdAt: { gte: since },
      },
      select: { masterWallet: true, realizedPnlUsd: true },
    });
    const byWallet = new Map<string, { wins: number; losses: number; realized: number }>();
    for (const t of traders) byWallet.set(t.wallet, { wins: 0, losses: 0, realized: 0 });
    for (const o of closed) {
      const w = o.masterWallet as string | null;
      if (!w || !byWallet.has(w)) continue;
      const s = byWallet.get(w) as { wins: number; losses: number; realized: number };
      const pnl = Number(o.realizedPnlUsd ?? 0);
      if (pnl > 0) s.wins++;
      else if (pnl < 0) s.losses++;
      s.realized = Math.round((s.realized + pnl) * 100) / 100;
    }
    const scored = scoreTraders(
      traders.map((t) => ({ wallet: t.wallet, ...(byWallet.get(t.wallet) as { wins: number; losses: number; realized: number }) })),
    );
    for (const s of scored) {
      await this.prisma.vaultTrader.updateMany({
        where: { vaultId, wallet: s.wallet },
        data: { weightBps: s.weightBps },
      });
    }
    await this.audit
      .record({
        actor: 'alloc:rebalance',
        action: 'copy.alloc_rebalance',
        target: `vault:${vaultId}`,
        reason: scored.map((s) => `${s.wallet.slice(0, 6)}=${s.weightBps}`).join(','),
      })
      .catch((e: unknown) => {
        console.warn('[alloc] audit record failed:', (e as Error).message);
      });
    return { vaultId, updated: scored.length, weights: scored.map((s) => ({ wallet: s.wallet, weightBps: s.weightBps })) };
  }
}
