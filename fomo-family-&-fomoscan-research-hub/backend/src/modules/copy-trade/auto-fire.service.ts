import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { CopyTradeService, type PaperOverrides } from './copy-trade.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface AutoFireSummary {
  scanned: number;
  fired: number;
  skippedNoScope: number;
  skippedDedupe: number;
  blocked: number;
  errors: number;
  orderIds: number[];
  haltedVaults: number[];
  note?: string;
}

const fresh = (): AutoFireSummary => ({
  scanned: 0,
  fired: 0,
  skippedNoScope: 0,
  skippedDedupe: 0,
  blocked: 0,
  errors: 0,
  orderIds: [],
  haltedVaults: [],
});

/** Gate-block messages from executePaper (expected outcomes, not crashes). */
function isGateBlock(message: string): boolean {
  return /Qualify blocked|Exposure cap|Slippage|ran \+|disabled|exceeds cap/i.test(message);
}

const num = (v: { toNumber(): number } | number | null | undefined): number | undefined => {
  if (typeof v === 'number') return v;
  return v?.toNumber() ?? undefined;
};

const r9 = (v: number): number => Math.round(v * 1e9) / 1e9;

/**
 * Kill-switch loss for one vault from its epoch NAV series (fix #6).
 * Same navAt logic as VaultService.advancedView: value at window start =
 * last checkpoint before the cutoff (fallback: current NAV → 0% on young
 * pools so fresh pools never halt on empty history).
 */
function vaultLoss(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  epochs: { navSol: any; createdAt: any }[],
): { dayPct: number; weekPct: number; nav: number } {
  const nav = epochs.length > 0 ? Number((epochs[epochs.length - 1].navSol as { toNumber(): number } | number)?.toString?.() ?? 0) : 0;
  const navNum = Number.isFinite(nav) ? (nav as number) : 0;
  const at = (ts: number): number | null => {
    const past = epochs.filter((e) => new Date(e.createdAt as unknown as string).getTime() <= ts);
    if (past.length === 0) return null;
    const last = past[past.length - 1];
    const v = last.navSol as { toNumber(): number } | number | string;
    return typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : v?.toNumber() ?? null;
  };
  const now = Date.now();
  const dayBase = at(now - 86400000) ?? navNum;
  const weekBase = at(now - 7 * 86400000) ?? navNum;
  const dayPct = dayBase > 0 ? r9(((navNum - dayBase) / dayBase) * 100) : 0;
  const weekPct = weekBase > 0 ? r9(((navNum - weekBase) / weekBase) * 100) : 0;
  return { dayPct, weekPct, nav: navNum };
}

function killLimits(rulesJson: unknown): { daily: number; weekly: number } {
  const r = (rulesJson ?? {}) as Record<string, unknown>;
  const daily = typeof r.dailyKillSwitchPct === 'number' && Number.isFinite(r.dailyKillSwitchPct) ? Math.abs(r.dailyKillSwitchPct as number) : 5;
  const weekly = typeof r.weeklyLossLimitPct === 'number' && Number.isFinite(r.weeklyLossLimitPct) ? Math.abs(r.weeklyLossLimitPct as number) : 15;
  return { daily: daily > 0 ? daily : 5, weekly: weekly > 0 ? weekly : 15 };
}

/**
 * T1 auto-fire engine (fund spec §7 target mode, sandbox paper-only).
 * Polls recent master BUYs, fires one paper order per fresh signal for the
 * first matching AUTO bot (vault trader-set scope), dedupes by masterTxHash.
 * Manual `tick()` doubles as the ADMIN test hook; the interval loop is the
 * production path (`COPY_AUTO_INTERVAL_MS`, default 5', `0` = manual only).
 */
@Injectable()
export class AutoFireService implements OnModuleInit {
  /** Test/smoke seam: base PaperOverrides merged under per-fire vaultId/triggeredBy. */
  public overrides: PaperOverrides = {};
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CopyTradeService) private readonly copy: CopyTradeService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const ms = Number(process.env.COPY_AUTO_INTERVAL_MS ?? 300000);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e: unknown) => {
        console.warn('[auto-fire] loop tick failed:', (e as Error).message);
      });
    }, ms);
    this.timer.unref?.();
  }

  async tick(windowMin = 15, limit = 10): Promise<AutoFireSummary> {
    if (this.running) return { ...fresh(), note: 'concurrent-tick-skipped' };
    this.running = true;
    try {
      const bots = await this.prisma.bot.findMany({ where: { mode: 'AUTO' }, orderBy: { id: 'asc' } });
      if (bots.length === 0) return { ...fresh(), note: 'no-auto-bots' };
      // Max lookback is env-overridable for demo seeding (default 120');
      // production stays at fresh-signal immediacy.
      const windowMax = Math.max(1, Number(process.env.AUTO_FIRE_WINDOW_MAX_MIN ?? 120) || 120);
      const since = new Date(Date.now() - Math.min(Math.max(windowMin, 1), windowMax) * 60000);
      const signals = await this.prisma.transaction.findMany({
        where: { action: 'BUY', createdAt: { gte: since }, NOT: [{ tokenMint: null }] },
        select: {
          signature: true,
          walletAddress: true,
          symbol: true,
          tokenMint: true,
          amountUsd: true,
          dexVenue: true,
          blockTime: true,
        },
        orderBy: { blockTime: 'desc' },
        take: 30,
      });
      const summary: AutoFireSummary = { ...fresh(), scanned: signals.length };
      if (signals.length === 0) return { ...summary, note: 'no-signals' };
      const vaultIds = [...new Set(bots.map((b) => b.vaultId ?? 1))];
      const [traders, wallets, vaultRows, epochRows] = await Promise.all([
        this.prisma.vaultTrader.findMany({ where: { vaultId: { in: vaultIds }, isActive: true } }),
        this.prisma.trackedWallet.findMany({ select: { address: true, label: true, handle: true } }),
        this.prisma.vault.findMany({ where: { id: { in: vaultIds } } }),
        this.prisma.epochCheckpoint.findMany({ where: { vaultId: { in: vaultIds } }, orderBy: { id: 'asc' } }),
      ]);
      // Fix #6 — real kill-switch: halted/paused vaults never fire. Breach of
      // day −5% / week −15% (rulesJson overridable) pauses the vault + audits.
      // Settle/withdraw continue elsewhere — only new positions halt here.
      const halted = new Set<number>();
      for (const vid of vaultIds) {
        const v = vaultRows.find((r) => r.id === vid) as unknown as { status?: unknown; rulesJson?: unknown } | undefined;
        if (!v) continue;
        if (((v.status as string | undefined) ?? 'live') !== 'live') {
          halted.add(vid);
          continue;
        }
        const eps = epochRows.filter((e) => e.vaultId === vid);
        const { dayPct, weekPct } = vaultLoss(eps as unknown as { navSol: unknown; createdAt: unknown }[]);
        const { daily, weekly } = killLimits(v?.rulesJson);
        if (dayPct <= -daily || weekPct <= -weekly) {
          halted.add(vid);
          summary.haltedVaults.push(vid);
          try {
            await this.prisma.vault.update({ where: { id: vid }, data: { status: 'paused' } });
          } catch {
            // pause failure must not block other vaults — firing is still skipped.
          }
          await this.audit
            .record({
              actor: 'system:kill-switch',
              action: 'copy.kill_switch_halt',
              target: `vault:${vid}`,
              reason: `day ${dayPct}% / week ${weekPct}% breached -${daily}%/-${weekly}%`,
            })
            .catch((e: unknown) => {
              console.warn('[auto-fire] kill-switch audit failed:', (e as Error).message);
            });
        }
      }
      // Pre-paused vaults are reported as halted too (no new audit row).
      for (const vid of vaultIds) {
        if (halted.has(vid) && !summary.haltedVaults.includes(vid)) summary.haltedVaults.push(vid);
      }
      const handleOf = new Map(wallets.map((w) => [w.address, w]));
      for (const s of signals.slice(0, Math.min(Math.max(limit, 1), 20))) {
        const bot = bots.find((b) =>
          traders.some((t) => t.vaultId === (b.vaultId ?? 1) && t.wallet === s.walletAddress),
        );
        if (!bot) {
          summary.skippedNoScope++;
          continue;
        }
        const botVault = bot.vaultId ?? 1;
        if (halted.has(botVault)) {
          summary.blocked++;
          continue;
        }
        const dupe = await this.prisma.copyOrder.findFirst({
          where: { masterTxHash: s.signature },
          select: { id: true },
        });
        if (dupe) {
          summary.skippedDedupe++;
          continue;
        }
        const meta = handleOf.get(s.walletAddress) as { label?: string; handle?: string } | undefined;
        try {
          const order = await this.copy.executePaper(
            {
              masterWallet: s.walletAddress,
              masterHandle: meta?.handle ?? meta?.label ?? undefined,
              masterTxHash: s.signature,
              symbol: s.symbol ?? undefined,
              action: 'BUY',
              tokenMint: s.tokenMint ?? undefined,
              amountUsd: num(s.amountUsd),
              venue: s.dexVenue ?? undefined,
              mode: 'paper',
              confirm: true,
              entryMode: 'immediate',
              tp1Pct: 60,
              stopPct: 30,
            },
            { ...this.overrides, vaultId: botVault, triggeredBy: `bot:${bot.id}` },
          );
          summary.fired++;
          summary.orderIds.push(order.id);
          await this.audit
            .record({
              actor: `bot:${bot.id}`,
              action: 'copy.auto_fire',
              target: `order:${order.id}`,
              reason: `signal ${s.signature.slice(0, 8)}… ${s.symbol ?? ''} vault:${botVault}`,
            })
            .catch((e: unknown) => {
              console.warn('[auto-fire] audit record failed:', (e as Error).message);
            });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'auto-fire failed';
          if (isGateBlock(msg)) summary.blocked++;
          else summary.errors++;
        }
      }
      return summary;
    } finally {
      this.running = false;
    }
  }
}
