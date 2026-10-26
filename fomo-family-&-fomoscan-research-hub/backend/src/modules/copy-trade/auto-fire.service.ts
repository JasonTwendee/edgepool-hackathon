import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CopyTradeService, type PaperOverrides } from './copy-trade.service.js';
import { AuditService } from '../audit/audit.service.js';
import { isHaltedVault, killLimits, vaultLoss } from './kill-switch.js';
import { emitSignal } from './signal-bus.js';

export interface AutoFireSummary {
  scanned: number;
  fired: number;
  skippedNoScope: number;
  skippedDedupe: number;
  skippedBeforeEntry: number;
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
  skippedBeforeEntry: 0,
  blocked: 0,
  errors: 0,
  orderIds: [],
  haltedVaults: [],
});

/** Gate-block messages from executePaper (expected outcomes, not crashes). */
function isGateBlock(message: string): boolean {
  return /Qualify blocked|Exposure cap|Slippage|ran \+|disabled|exceeds cap|Kill-switch|open positions|Per-mint cap/i.test(message);
}

const num = (v: { toNumber(): number } | number | null | undefined): number | undefined => {
  if (typeof v === 'number') return v;
  return v?.toNumber() ?? undefined;
};

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
      // Forward-only safety: production clocks on on-chain blockTime. The
      // createdAt fallback is only for legacy/demo seeding where blockTime is
      // synthetic; it must never be used for a live roster.
      const signalClock = process.env.AUTO_FIRE_SIGNAL_CLOCK === 'createdAt' ? 'createdAt' : 'blockTime';
      const signalWhere: Prisma.TransactionWhereInput =
        signalClock === 'createdAt'
          ? { action: 'BUY', createdAt: { gte: since }, NOT: [{ tokenMint: null }] }
          : {
              action: 'BUY',
              blockTime: { gte: BigInt(Math.floor(since.getTime() / 1000)) },
              NOT: [{ tokenMint: null }],
            };
      const signals = await this.prisma.transaction.findMany({
        where: signalWhere,
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
        const halt = isHaltedVault(v?.status, v?.rulesJson, eps as unknown as { navSol: unknown; createdAt: unknown }[]);
        const { dayPct, weekPct, daily, weekly } = halt;
        if (halt.halted) {
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
        // Both public pools share the same 5 traders: a signal must fire once
        // PER POOL, not just for the first matching bot (vault 15 never got
        // orders while vault 14 consumed every signal).
        const matchingBots = bots.filter((b) =>
          traders.some((t) => t.vaultId === (b.vaultId ?? 1) && t.wallet === s.walletAddress),
        );
        if (matchingBots.length === 0) {
          summary.skippedNoScope++;
          continue;
        }
        const meta = handleOf.get(s.walletAddress) as { label?: string; handle?: string } | undefined;
        for (const bot of matchingBots) {
          const botVault = bot.vaultId ?? 1;
          const vaultMeta = vaultRows.find((v) => v.id === botVault) as unknown as
            | { name?: string; chainEnv?: string | null }
            | undefined;
          // Devnet demo pools intentionally skip RugCheck: their tokens are
          // throwaway demo memecoins and the gate would block every entry,
          // leaving the on-chain demo pool without signals. Scoped strictly to
          // demo-chain-* on devnet; real pools keep the strict gate.
          const demoChainPool =
            Boolean(vaultMeta?.name?.startsWith('demo-chain')) && vaultMeta?.chainEnv === 'devnet';
          const trader = traders.find(
            (t) => t.vaultId === botVault && t.wallet === s.walletAddress,
          );
          const enteredSec = trader?.enteredAt
            ? Math.floor(trader.enteredAt.getTime() / 1000)
            : 0;
          if (Number(s.blockTime) < enteredSec) {
            summary.skippedBeforeEntry++;
            continue;
          }
          if (halted.has(botVault)) {
            summary.blocked++;
            continue;
          }
          // Dedupe is per pool: the same master tx seeds one order per vault.
          const dupe = await this.prisma.copyOrder.findFirst({
            where: { masterTxHash: s.signature, vaultId: botVault },
            select: { id: true },
          });
          if (dupe) {
            summary.skippedDedupe++;
            continue;
          }
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
                // No pinned tp1/stop: the engine ATR-tunes from 1h volatility
                // (falls back to 60/30 when candles are missing).
              },
              {
                ...this.overrides,
                vaultId: botVault,
                triggeredBy: `bot:${bot.id}`,
                ...(demoChainPool ? { strict: false, skipNavCaps: true } : {}),
              },
            );
            summary.fired++;
            summary.orderIds.push(order.id);
            emitSignal({
              vaultId: botVault,
              kind: 'ENTER',
              token: s.symbol ?? (s.tokenMint ?? '').slice(0, 8),
              trader: meta?.handle ?? meta?.label ?? s.walletAddress.slice(0, 8),
              note: `order #${order.id} entered`,
            });
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
            emitSignal({
              vaultId: botVault,
              kind: 'SKIP',
              token: s.symbol ?? (s.tokenMint ?? '').slice(0, 8),
              trader: meta?.handle ?? meta?.label ?? s.walletAddress.slice(0, 8),
              note: msg.slice(0, 120),
            });
          }
        }
      }
      return summary;
    } finally {
      this.running = false;
    }
  }
}
