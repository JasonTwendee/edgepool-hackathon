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

/** Prune theo batch (tránh ôm triệu rows vào heap). */
const PRUNE_BATCH = 2000;
/** Số batch tối đa/tick; còn dư tick sau resume (guard 24h chỉ set khi hết việc). */
const PRUNE_MAX_BATCHES = 5;

/** Stats recompute thưa ra (RAM/CPU cut): chỉ khi có tx mới hoặc quá gap. */
const STATS_MIN_GAP_MS =
  process.env.SYNC_STATS_INTERVAL_MS && Number.isFinite(Number(process.env.SYNC_STATS_INTERVAL_MS))
    ? Number(process.env.SYNC_STATS_INTERVAL_MS)
    : 300000;

/** ~4-month history window (days) for the safety-net sync (override via FULL_HISTORY_DAYS). */
const HISTORY_DAYS =
  process.env.FULL_HISTORY_DAYS && Number.isFinite(Number(process.env.FULL_HISTORY_DAYS))
    ? Number(process.env.FULL_HISTORY_DAYS)
    : 120;

/**
 * Safety-net sync (RPC polling so the WS stream can never silently die):
 * every SYNC_INTERVAL_MS (default 20s), top up each LIVE-SCOPE wallet toward
 * full history (FULL_HISTORY_DAYS, default 120d) from RPC, enrich via Helius,
 * persist, then recompute stats for the same set. First boot does the full
 * backfill in the background (non-blocking) with per-wallet progress logs.
 * Overlap-guarded; failures are logged per wallet, never crash the loop.
 */
@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPruneAt = 0;
  private lastStatsAt = 0;

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
      // Live scope = active traders of public/live pools (fallback: DB-active).
      // Non-pool leaderboard wallets stay frozen; history/orders are kept.
      const wallets = await this.wallets.findAllLive();
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
      const statsUpdated =
        fresh > 0 || Date.now() - this.lastStatsAt >= STATS_MIN_GAP_MS
          ? await this.syncStatsThrottled(wallets.map((w) => w.address))
          : 0;
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
  /**
   * Stats recompute có throttle: ví không có tx mới thì số không đổi,
   * recompute lại mỗi tick là đốt RAM/CPU vô ích. Vẫn recompute ngay khi
   * có tx mới nên UI chậm nhất 1 tick sau data mới.
   */
  private async syncStatsThrottled(addresses: string[]): Promise<number> {
    this.lastStatsAt = Date.now();
    return this.pnl.syncWalletStats(HISTORY_DAYS, addresses);
  }

  /**
   * Rolling window cleanup (max once/day). BATCHED (RAM cut, 2026-10-16):
   * bản cũ load TOÀN BỘ rows quá hạn vào heap 1 lần (triệu rows sau mỗi
   * restart vì lastPruneAt reset) → spike 2GB/OOM. Giờ count trước, xử lý
   * cuốn chiếu mỗi batch 2000 rows (archive JSONL + audit rồi mới delete đúng
   * IDs vừa archive), tối đa PRUNE_MAX_BATCHES batch/tick, tick sau resume.
   * Fail-safe giữ nguyên: archive/audit lỗi → zero deletes batch đó.
   * Scope vẫn CHỈ transactions + realtime_events (ledger/audit/orders/vaults
   * KHÔNG BAO GIỜ vào diện prune).
   */
  async pruneOnce(): Promise<number> {
    if (Date.now() - this.lastPruneAt < 86400000) return 0;
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000);
    const cutoffSec = Math.floor(cutoff.getTime() / 1000);
    try {
      const [txCount, evCount] = await Promise.all([
        this.prisma.transaction.count({ where: { blockTime: { lt: BigInt(cutoffSec) } } }),
        this.prisma.realtimeEvent.count({ where: { broadcastedAt: { lt: cutoff } } }),
      ]);
      if (txCount + evCount === 0) {
        this.lastPruneAt = Date.now();
        return 0;
      }
      const day = cutoff.toISOString().slice(0, 10);
      let total = 0;
      for (let b = 0; b < PRUNE_MAX_BATCHES; b++) {
        const [oldTx, oldEv] = await Promise.all([
          this.prisma.transaction.findMany({
            where: { blockTime: { lt: BigInt(cutoffSec) } },
            orderBy: { blockTime: 'asc' },
            take: PRUNE_BATCH,
          }),
          this.prisma.realtimeEvent.findMany({
            where: { broadcastedAt: { lt: cutoff } },
            orderBy: { broadcastedAt: 'asc' },
            take: PRUNE_BATCH,
          }),
        ]);
        if (oldTx.length + oldEv.length === 0) break;
        const txFile =
          oldTx.length > 0
            ? await writeArchiveFile(this.archiveDir, `prune-${day}-transactions.jsonl`, oldTx)
            : null;
        const evFile =
          oldEv.length > 0
            ? await writeArchiveFile(this.archiveDir, `prune-${day}-events.jsonl`, oldEv)
            : null;
        await this.audit.record({
          actor: 'system:sync',
          action: 'sync.prune_archive',
          target: `${txFile?.file ?? '-'},${evFile?.file ?? '-'}`,
          reason: `cutoff ${cutoff.toISOString()} (${HISTORY_DAYS}d): ${oldTx.length} tx + ${oldEv.length} events (batch ${b + 1})`,
          metaJson: {
            cutoff: cutoff.toISOString(),
            historyDays: HISTORY_DAYS,
            txCount: oldTx.length,
            txFile: txFile?.file ?? null,
            txSha256: txFile?.sha256 ?? null,
            eventCount: oldEv.length,
            eventFile: evFile?.file ?? null,
            eventSha256: evFile?.sha256 ?? null,
          },
        });
        const [tx, ev] = await Promise.all([
          oldTx.length > 0
            ? this.prisma.transaction.deleteMany({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                where: { signature: { in: oldTx.map((t) => (t as any).signature) } } as any,
              })
            : { count: 0 },
          oldEv.length > 0
            ? this.prisma.realtimeEvent.deleteMany({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                where: { id: { in: oldEv.map((e) => (e as any).id) } } as any,
              })
            : { count: 0 },
        ]);
        total += tx.count + ev.count;
        if (oldTx.length < PRUNE_BATCH && oldEv.length < PRUNE_BATCH) break;
      }
      if (total > 0) {
        // eslint-disable-next-line no-console
        console.log(`[SyncScheduler] pruned ${total} rows older than ${HISTORY_DAYS}d (archived, batched)`);
      }
      return total;
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
