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
});

/** Gate-block messages from executePaper (expected outcomes, not crashes). */
function isGateBlock(message: string): boolean {
  return /Qualify blocked|Exposure cap|Slippage|ran \+|disabled|exceeds cap/i.test(message);
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
      const since = new Date(Date.now() - Math.min(Math.max(windowMin, 1), 120) * 60000);
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
      const [traders, wallets] = await Promise.all([
        this.prisma.vaultTrader.findMany({ where: { vaultId: { in: vaultIds }, isActive: true } }),
        this.prisma.trackedWallet.findMany({ select: { address: true, label: true, handle: true } }),
      ]);
      const handleOf = new Map(wallets.map((w) => [w.address, w]));
      for (const s of signals.slice(0, Math.min(Math.max(limit, 1), 20))) {
        const bot = bots.find((b) =>
          traders.some((t) => t.vaultId === (b.vaultId ?? 1) && t.wallet === s.walletAddress),
        );
        if (!bot) {
          summary.skippedNoScope++;
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
        const botVault = bot.vaultId ?? 1;
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
