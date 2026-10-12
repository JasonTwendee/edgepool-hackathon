import { Inject, Injectable } from '@nestjs/common';
import type { ConfirmedSignatureInfo } from '@solana/web3.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  SolanaOnChainListenerService,
  type TrackedWallet,
} from '../../server/solana.service.js';
import type { OnChainTransactionEvent } from '../onchain/entities/onchain-event.entity.js';
import { EnrichService, type EnrichedPartial } from '../helius/enrich.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { TxParseService } from '../../common/chain/tx-parse.service.js';

const DEFAULT_DAYS = 120;
const DEFAULT_MAX_TX = 1000;
// Helius paginates reliably with small pages; big limits truncate `before`.
const PAGE_LIMIT = 100;
const HEAL_BATCH = 200;
// Live pipeline cutoff: events older than this are backfill, not "live".
const LIVE_STALENESS_SEC = 15 * 60;

/** Backfilled history must not fan out as live notifications/feed items. */
export function isStaleLiveEvent(event: { blockTime: number }): boolean {
  return Math.floor(Date.now() / 1000) - event.blockTime > LIVE_STALENESS_SEC;
}

/**
 * 30-day history sync per wallet (or full catch-up): paginate signatures
 * newest→oldest until a known signature / cutoff / cap, enrich via Helius
 * with a pure-RPC parse fallback, persist. Idempotent (PK dedup) — safe to
 * rerun; doubles as the RPC-polling safety net behind the WS event stream.
 */
@Injectable()
export class HistorySyncService {
  constructor(
    @Inject(SolanaOnChainListenerService)
    private readonly solana: SolanaOnChainListenerService,
    @Inject(EnrichService) private readonly enrich: EnrichService,
    @Inject(DataStreamService) private readonly prices: DataStreamService,
    @Inject(TransactionsService) private readonly tx: TransactionsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TxParseService) private readonly rpcParse: TxParseService,
  ) {}

  async syncWallet(
    wallet: TrackedWallet,
    opts: { days?: number; maxTx?: number } = {},
  ): Promise<{ added: number; healed: number; total: number; events: OnChainTransactionEvent[] }> {    const days = opts.days ?? DEFAULT_DAYS;
    const maxTx = opts.maxTx ?? DEFAULT_MAX_TX;
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

    const healed = await this.healWallet(wallet.address);

    // Deep mode until the wallet owns at least one row older than the cutoff;
    // afterwards incremental mode (stop at first known signature). This keeps
    // the 60s loop cheap once 30d history is complete.
    const oldest = await this.tx.getOldestBlockTime(wallet.address);
    const deep = oldest === null || oldest >= cutoff;

    const known = await this.tx.getSignatures(wallet.address);
    const fresh: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    const requested = Math.min(PAGE_LIMIT, maxTx);
    for (;;) {
      const page = await this.solana.fetchSignatures(wallet.address, {
        limit: requested,
        before,
      });
      if (page.length === 0) break;
      let stop = false;
      for (const s of page) {
        if (!deep && known.has(s.signature)) {
          stop = true;
          break;
        }
        if ((s.blockTime ?? Math.floor(Date.now() / 1000)) < cutoff) {
          stop = true;
          break;
        }
        if (!known.has(s.signature)) {
          fresh.push(s);
          known.add(s.signature);
        }
        if (fresh.length >= maxTx) {
          stop = true;
          break;
        }
      }
      before = page[page.length - 1].signature;
      if (stop || page.length < requested) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    const enriched = await this.enrich.enrichMany(wallet.address, fresh);
    // Helius-free fallback: classify fresh signatures Helius didn't cover via
    // pure-RPC parse. Without this every row stays UNKNOWN and auto-fire
    // starves (Helius decommissioned 2026-10-07). Parse failures keep the
    // minimal UNKNOWN row — classification must never break ingestion.
    const covered = new Set(enriched.keys());
    const rpcParsed = await this.rpcParse.classifyFresh(wallet.address, fresh, covered);
    let added = 0;
    const events: OnChainTransactionEvent[] = [];
    for (const s of fresh) {
      const rpc = rpcParsed.get(s.signature);
      const event = this.enrich.assembleEvent(wallet, s, enriched.get(s.signature) ?? rpc, rpc ? 'rpc-parser' : undefined);
      if (await this.tx.recordTransaction(event, { source: 'history-sync', enriched: event.source === 'helius' })) {
        added++;
        events.push(event);
        // Safety-net path also feeds the live pipeline so SSE clients and
        // /api/onchain/events stay fresh even when the WS socket is quiet.
        await this.publishLive(event);
      }
    }
    const total = await this.tx.countByWallet(wallet.address);
    return { added, healed, total, events };
  }

  /**
   * Fan-out for rows discovered by the safety-net sync: persist a realtime
   * event (deduped by tx signature — the WS pipeline may race us) and push
   * to SSE subscribers. Only fresh activity is published: backfilled history
   * is already visible via the ledger/polling and must not spam live feeds.
   * Failures never break the sync loop.
   */
  private async publishLive(event: OnChainTransactionEvent): Promise<void> {
    if (isStaleLiveEvent(event)) return;    try {
      const existing = await this.prisma.realtimeEvent.findFirst({
        where: { txSignature: event.signature },
        select: { id: true },
      });
      if (!existing) {
        const amount =
          event.amountUsd !== undefined ? ` $${event.amountUsd.toLocaleString('en-US')}` : '';
        await this.prisma.realtimeEvent.create({
          data: {
            eventType: 'ONCHAIN_SWAP_EVENT',
            walletAddress: event.wallet,
            txSignature: event.signature,
            title: `${event.action} ${event.symbol}${amount} on ${event.dexVenue} — ${event.wallet}`.slice(0, 200),
            payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
          },
        });
      }
      this.solana.emitLive(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[HistorySync] publishLive ${event.signature.slice(0, 8)}… failed:`, (err as Error).message);
    }
  }

  /**
   * One-time heal for rows persisted before enrichment existed
   * (raw_payload without an `enriched` flag): re-parse and patch in place.
   * Also retries rows whose USD pricing is still missing (new price sources
   * land over time), capped at 2 attempts per row via raw_payload marker.
   */
  private async healWallet(address: string): Promise<number> {
    const rows = await this.prisma.transaction.findMany({
      where: { walletAddress: address },
      select: { signature: true, amountUsd: true, rawPayload: true },
      take: HEAL_BATCH,
    });
    const pendingUnenriched = rows.filter((r) => {
      const raw = r.rawPayload as { enriched?: boolean } | null;
      return !raw || raw.enriched !== true;
    });
    const pendingUsd = rows.filter((r) => {
      if (r.amountUsd !== null) return false;
      const raw = r.rawPayload as { usdHealAttempts?: number } | null;
      return (raw?.usdHealAttempts ?? 0) < 2;
    });
    const targets = new Map<string, 'full' | 'usd'>();
    for (const r of pendingUnenriched) targets.set(r.signature, 'full');
    for (const r of pendingUsd) {
      if (!targets.has(r.signature)) targets.set(r.signature, 'usd');
    }
    if (targets.size === 0) return 0;
    const sigs = [...targets.keys()];
    // Reuse enrich pipeline with stub sigInfos (slot/time refreshed from parse below is skipped;
    // only action/symbol/amounts/venue/status are patched).
    const enriched = await this.enrich.enrichMany(address, sigs.map((signature) => ({
      signature,
      slot: 0,
      blockTime: 0,
      err: null,
      memo: null,
    })));
    let healed = 0;
    const attempted = new Set<string>();
    for (const [sig, partial] of enriched) {
      await this.tx.applyEnrichment(sig, {
        action: partial.action,
        symbol: partial.symbol,
        tokenMint: partial.tokenMint ?? null,
        amountToken: partial.amountToken ?? null,
        amountUsd: partial.amountUsd ?? null,
        dexVenue: partial.dexVenue,
        status: partial.status,
        feeSol: partial.feeSol,
      });
      attempted.add(sig);
      if (targets.get(sig) === 'full' || partial.amountUsd !== undefined) healed++;
    }
    // Mark USD-only retries so dust rows stop consuming Helius quota.
    for (const sig of targets.keys()) {
      if (targets.get(sig) !== 'usd' || attempted.has(sig)) continue;
      await this.markUsdHealAttempted(sig);
    }
    for (const [sig, partial] of enriched) {
      if (targets.get(sig) === 'usd' && partial.amountUsd === undefined) {
        await this.markUsdHealAttempted(sig);
      }
    }
    healed += await this.healUsdViaCandles(address);
    return healed;
  }

  /**
   * Candle backfill for rows still missing USD: qty × candle close at
   * blockTime (DataStream, 1H interval). Bounded (10 mints/pass) and marked
   * attempted so gaps don't spin forever.
   */
  private async healUsdViaCandles(address: string): Promise<number> {
    const rows = await this.prisma.transaction.findMany({
      where: { walletAddress: address, amountUsd: null, NOT: [{ tokenMint: null }] },
      select: { signature: true, tokenMint: true, amountToken: true, blockTime: true, rawPayload: true },
      take: 60,
    });
    const candidates = rows.filter((r) => {
      const raw = r.rawPayload as { usdHealAttempts?: number } | null;
      return (raw?.usdHealAttempts ?? 0) < 2 && r.amountToken !== null && Number(r.blockTime) > 0;
    });
    if (candidates.length === 0) return 0;
    const byMint = new Map<string, typeof candidates>();
    for (const r of candidates) {
      const mint = r.tokenMint as string;
      if (!byMint.has(mint)) byMint.set(mint, []);
      byMint.get(mint)!.push(r);
    }
    let healed = 0;
    let mints = 0;
    for (const [mint, list] of byMint) {
      if (mints++ >= 10) break;
      const times = list.map((r) => Number(r.blockTime));
      const from = Math.min(...times) - 3600;
      const to = Math.max(...times) + 3600;
      let candles: { close: number; timestamp: number }[] = [];
      try {
        candles = await this.prices.candles(mint, {
          interval: '1H',
          from,
          to,
          count: Math.min(200, Math.max(2, Math.ceil((to - from) / 3600) + 1)),
        });
      } catch {
        continue;
      }
      if (candles.length === 0) continue;
      for (const r of list) {
        const t = Number(r.blockTime);
        let best = candles[0];
        for (const c of candles) {
          if (c.timestamp <= t) best = c;
          else break;
        }
        const qty = r.amountToken?.toNumber() ?? 0;
        if (!(best.close > 0) || !(qty > 0)) {
          await this.markUsdHealAttempted(r.signature);
          continue;
        }
        await this.prisma.transaction.update({
          where: { signature: r.signature },
          data: { amountUsd: Math.round(qty * best.close * 100) / 100 },
        });
        healed++;
      }
    }
    return healed;
  }

  private async markUsdHealAttempted(signature: string): Promise<void> {
    const existing = await this.prisma.transaction.findUnique({
      where: { signature },
      select: { rawPayload: true },
    });
    if (!existing) return;
    const raw = (existing.rawPayload as Record<string, unknown> | null) ?? {};
    await this.prisma.transaction.update({
      where: { signature },
      data: {
        rawPayload: {
          ...raw,
          usdHealAttempts: ((raw.usdHealAttempts as number | undefined) ?? 0) + 1,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
