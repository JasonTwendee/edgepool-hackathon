import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../database/prisma.service.js';
import { SYNC_INTERVAL_MS } from '../../config/solana.config.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { PnlService } from '../portfolio/pnl.service.js';
import { HistorySyncService } from './history-sync.service.js';
import { AuditService } from '../audit/audit.service.js';

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
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Archive dir seam (tests override with a tmpdir). Mount as a volume for durability. */
  public archiveDir: string = process.env.PRUNE_ARCHIVE_DIR ?? 'data/archive';

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
   * Rolling window cleanup (max once/day). Fix 10: pruned rows are archived
   * to JSONL + an audit row BEFORE any delete (fail-safe: archive/audit
   * failure → zero deletes). Scope is raw chain data ONLY (transactions +
   * realtime_events, re-fetchable from archive) — money ledger
   * (deposits/withdrawals/epochs/payouts) and audit/sessions/orders/vaults
   * are NEVER in prune scope. Deletes target exactly the archived row IDs
   * (never a re-evaluated cutoff) so no unarchived row can slip through.
   */
  async pruneOnce(): Promise<number> {
    if (Date.now() - this.lastPruneAt < 86400000) return 0;
    this.lastPruneAt = Date.now();
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000);
    try {
      const [oldTx, oldEv] = await Promise.all([
        this.prisma.transaction.findMany({ where: { blockTime: { lt: BigInt(Math.floor(cutoff.getTime() / 1000)) } } }),
        this.prisma.realtimeEvent.findMany({ where: { broadcastedAt: { lt: cutoff } } }),
      ]);
      if (oldTx.length + oldEv.length === 0) return 0;
      const day = cutoff.toISOString().slice(0, 10);
      const txFile = await writeArchiveFile(this.archiveDir, `prune-${day}-transactions.jsonl`, oldTx);
      const evFile = await writeArchiveFile(this.archiveDir, `prune-${day}-events.jsonl`, oldEv);
      await this.audit.record({
        actor: 'system:sync',
        action: 'sync.prune_archive',
        target: `${txFile.file},${evFile.file}`,
        reason: `cutoff ${cutoff.toISOString()} (${HISTORY_DAYS}d): ${oldTx.length} tx + ${oldEv.length} events`,
        metaJson: {
          cutoff: cutoff.toISOString(),
          historyDays: HISTORY_DAYS,
          txCount: oldTx.length,
          txFile: txFile.file,
          txSha256: txFile.sha256,
          eventCount: oldEv.length,
          eventFile: evFile.file,
          eventSha256: evFile.sha256,
        },
      });
      const [tx, ev] = await Promise.all([
        this.prisma.transaction.deleteMany({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where: { signature: { in: oldTx.map((t) => (t as any).signature) } } as any,
        }),
        this.prisma.realtimeEvent.deleteMany({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where: { id: { in: oldEv.map((e) => (e as any).id) } } as any,
        }),
      ]);
      const n = tx.count + ev.count;
      if (n > 0) {
        // eslint-disable-next-line no-console
        console.log(`[SyncScheduler] pruned ${tx.count} tx + ${ev.count} events older than ${HISTORY_DAYS}d (archived)`);
      }
      return n;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SyncScheduler] prune failed (no rows deleted):', (err as Error).message);
      return 0;
    }
  }
}

/** JSON-safe stringify (BigInt → string; Prisma Decimal serializes via toJSON). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonLine = (row: any): string => JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

/** Append rows as JSONL, return file + sha256 of the appended bytes. */
export async function writeArchiveFile(
  dir: string,
  filename: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[],
): Promise<{ file: string; sha256: string; count: number }> {
  await fs.mkdir(dir, { recursive: true });
  const body = rows.map((r) => jsonLine(r)).join('\n') + '\n';
  await fs.appendFile(join(dir, filename), body, 'utf8');
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex');
  return { file: filename, sha256, count: rows.length };
}
