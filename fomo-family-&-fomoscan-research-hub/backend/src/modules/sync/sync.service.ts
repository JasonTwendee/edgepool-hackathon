import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { SYNC_INTERVAL_MS } from '../../config/solana.config.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { PnlService } from '../portfolio/pnl.service.js';
import { HistorySyncService } from './history-sync.service.js';

const HISTORY_MAX_TX = 1000;

/** ~4-month history window (days) for the safety-net sync (override via FULL_HISTORY_DAYS). */
const HISTORY_DAYS =
  process.env.FULL_HISTORY_DAYS && Number.isFinite(Number(process.env.FULL_HISTORY_DAYS))
    ? Number(process.env.FULL_HISTORY_DAYS)
    : 120;

/**
 * Safety-net sync (RPC polling so the WS stream can never silently die):
 * every SYNC_INTERVAL_MS (default 20s), top up each wallet toward full
 * history (FULL_HISTORY_DAYS, default ~10y) from RPC, enrich via
 * Helius, persist, then recompute stats. First boot does the full backfill
 * in the background (non-blocking) with per-wallet progress logs.
 * Overlap-guarded; failures are logged per wallet, never crash the loop.
 */
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPruneAt = 0;

  constructor(
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(HistorySyncService) private readonly history: HistorySyncService,
    @Inject(PnlService) private readonly pnl: PnlService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // eslint-disable-next-line no-console
    console.log(
      `[SyncScheduler] Safety-net RPC sync every ${SYNC_INTERVAL_MS}ms (${HISTORY_DAYS}d window, cap ${HISTORY_MAX_TX}/wallet).`,
    );
    // Non-blocking: API serves immediately while the first backfill runs.
    setImmediate(() => void this.syncOnce('boot'));
    this.timer = setInterval(() => void this.syncOnce('interval'), SYNC_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async syncOnce(reason: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Dropped wallets stay frozen: no fresh signals needed, history kept.
      const wallets = (await this.wallets.findAll()).filter((w) => w.isActive !== false);
      let fresh = 0;
      for (const w of wallets) {
        try {
          const r = await this.history.syncWallet(w, {
            days: HISTORY_DAYS,
            maxTx: HISTORY_MAX_TX,
          });
          fresh += r.added;
          // eslint-disable-next-line no-console
          console.log(
            `[SyncScheduler] ${w.label} (${w.address.slice(0, 6)}…): +${r.added} new (healed ${r.healed}), total ${r.total}`,
          );
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`[SyncScheduler] ${w.address.slice(0, 8)}… failed:`, (err as Error).message);
        }
      }
      const statsUpdated = await this.pnl.syncWalletStats(HISTORY_DAYS);
      const pruned = await this.pruneOnce();
      // eslint-disable-next-line no-console
      console.log(
        `[SyncScheduler] (${reason}) wallets=${wallets.length} newTx=${fresh} statsUpdated=${statsUpdated} pruned=${pruned}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Rolling window cleanup (max once/day): drop ledger rows older than the
   * history window so the DB never grows stale. Audit/sessions/orders/vaults
   * are NEVER pruned — only raw chain data (re-fetchable from archive).
   */
  private async pruneOnce(): Promise<number> {
    if (Date.now() - this.lastPruneAt < 86400000) return 0;
    this.lastPruneAt = Date.now();
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000);
    try {
      const [tx, ev] = await Promise.all([
        this.prisma.transaction.deleteMany({ where: { blockTime: { lt: BigInt(Math.floor(cutoff.getTime() / 1000)) } } }),
        this.prisma.realtimeEvent.deleteMany({ where: { broadcastedAt: { lt: cutoff } } }),
      ]);
      const n = tx.count + ev.count;
      if (n > 0) {
        // eslint-disable-next-line no-console
        console.log(`[SyncScheduler] pruned ${tx.count} tx + ${ev.count} events older than ${HISTORY_DAYS}d`);
      }
      return n;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SyncScheduler] prune failed:', (err as Error).message);
      return 0;
    }
  }
}
