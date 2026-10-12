import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { OnChainTransactionEvent } from '../onchain/entities/onchain-event.entity.js';

type TxRow = Prisma.TransactionGetPayload<{ include: { wallet: true } }>;

export interface LedgerQuery {
  walletAddress?: string;
  /** 'ALL' or undefined = no action filter. */
  action?: 'BUY' | 'SELL';
  /** Exclude rows without a positive USD value (dust). */
  hideZero?: boolean;
  sinceSec?: number;
  skip?: number;
  take?: number;
}

/**
 * Persistence for the reference-schema `transactions` ledger.
 * Rows are immutable once enriched: signature PK dedups, conflicts keep the
 * existing row unless an enrichment patch arrives for an unenriched row.
 */
@Injectable()
export class TransactionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Insert unless the signature already exists; advances wallet cursor+counter on insert. */
  async recordTransaction(event: OnChainTransactionEvent, rawPayload: unknown): Promise<boolean> {
    const payload = {
      ...((rawPayload as Record<string, unknown> | null) ?? {}),
      eventSource: event.source,
      // 'rpc' = bare signature row (heal retries later); anything parsed —
      // Helius or the pure-RPC fallback — is final and skipped by heal.
      enriched: event.source !== 'rpc',
    } as Prisma.InputJsonValue;
    try {
      await this.prisma.transaction.create({
        data: {
          signature: event.signature,
          walletAddress: event.wallet,
          slot: BigInt(event.slot),
          blockTime: BigInt(event.blockTime),
          formattedTime: event.formattedTime,
          action: event.action,
          symbol: event.symbol,
          tokenMint: event.tokenMint ?? null,
          amountToken: event.amountToken ?? null,
          amountUsd: event.amountUsd ?? null,
          dexVenue: event.dexVenue,
          slippageBps: event.slippageBps,
          feeSol: event.feeSol,
          status: event.status,
          rawPayload: payload,
        },
      });
    } catch (e: unknown) {
      // P2002 = duplicate signature (already persisted) — not an error.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
    // Best-effort cursor/counter (updateMany never throws on missing wallet).
    await this.prisma.trackedWallet.updateMany({
      where: { address: event.wallet },
      data: {
        lastScannedSlot: BigInt(event.slot),
        lastScannedSignature: event.signature,
        totalTradesCount: { increment: 1 },
      },
    });
    return true;
  }

  /** Patch an unenriched row with Helius-parsed fields (heal path). */
  async applyEnrichment(
    signature: string,
    patch: {
      action: string;
      symbol: string;
      tokenMint: string | null;
      amountToken: number | null;
      amountUsd: number | null;
      dexVenue: string;
      status: string;
      feeSol: number;
    },
  ): Promise<void> {
    const existing = await this.prisma.transaction.findUnique({
      where: { signature },
      select: { signature: true, rawPayload: true },
    });
    if (!existing) return;
    const raw = (existing.rawPayload as Record<string, unknown> | null) ?? {};
    await this.prisma.transaction.update({
      where: { signature },
      data: {
        ...patch,
        rawPayload: { ...raw, eventSource: 'helius', enriched: true } as Prisma.InputJsonValue,
      },
    });
  }

  /** Paginated ledger query (newest first), mapped to the API shape.
   *  Display surface is BUY/SELL only — TRANSFER/UNKNOWN rows stay in the DB
   *  for accounting but never surface in tables, charts, or counts. */
  async queryLedger(q: LedgerQuery): Promise<{ rows: OnChainTransactionEvent[]; total: number }> {
    const where: Prisma.TransactionWhereInput = {
      ...(q.walletAddress ? { walletAddress: q.walletAddress } : {}),
      ...(q.action ? { action: q.action } : { action: { in: ['BUY', 'SELL'] } }),
      ...(q.hideZero ? { amountUsd: { gt: 0 } } : {}),
      ...(q.sinceSec !== undefined ? { blockTime: { gte: BigInt(q.sinceSec) } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ slot: 'desc' }, { blockTime: 'desc' }],
        skip: q.skip ?? 0,
        take: q.take ?? 10,
        include: { wallet: true },
      }),
    ]);
    return { rows: rows.map((t) => this.mapRow(t)), total };
  }

  /** Full ascending range for analytics (PnL/chart), capped by caller intent. */
  async getRange(walletAddress: string, cutoffSec: number): Promise<OnChainTransactionEvent[]> {
    const rows = await this.prisma.transaction.findMany({
      where: { walletAddress, blockTime: { gte: BigInt(cutoffSec) } },
      orderBy: [{ slot: 'asc' }, { blockTime: 'asc' }],
      take: 100000,
      include: { wallet: true },
    });
    return rows.map((t) => this.mapRow(t));
  }

  /** Signature set for dedup during sync (single column, cheap). */
  async getSignatures(walletAddress: string): Promise<Set<string>> {
    const rows = await this.prisma.transaction.findMany({
      where: { walletAddress },
      select: { signature: true },
    });
    return new Set(rows.map((r) => r.signature));
  }

  /** Oldest blockTime for deep-vs-incremental sync decision (null = empty). */
  async getOldestBlockTime(walletAddress: string): Promise<number | null> {
    const row = await this.prisma.transaction.findFirst({
      where: { walletAddress },
      orderBy: { blockTime: 'asc' },
      select: { blockTime: true },
    });
    return row ? Number(row.blockTime) : null;
  }

  async countByWallet(walletAddress: string): Promise<number> {
    return this.prisma.transaction.count({ where: { walletAddress } });
  }

  private mapRow(t: TxRow): OnChainTransactionEvent {
    const w = t.wallet;
    const amountUsd = t.amountUsd?.toNumber() ?? undefined;
    const dexVenue = t.dexVenue as OnChainTransactionEvent['dexVenue'];
    const raw = t.rawPayload as { eventSource?: string } | null;
    return {
      signature: t.signature,
      slot: Number(t.slot),
      blockTime: Number(t.blockTime),
      formattedTime: t.formattedTime,
      wallet: t.walletAddress,
      walletName: `@${w.handle} (${w.label})`,
      source: (['helius', 'rpc-parser'].includes(raw?.eventSource ?? '') ? raw!.eventSource : 'rpc') as OnChainTransactionEvent['source'],
      action: t.action as OnChainTransactionEvent['action'],
      symbol: t.symbol,
      tokenMint: t.tokenMint ?? undefined,
      amountToken: t.amountToken?.toNumber() ?? undefined,
      amountUsd,
      dexVenue,
      slippageBps: t.slippageBps,
      status: t.status as OnChainTransactionEvent['status'],
      feeSol: t.feeSol.toNumber(),
      copySignal: {
        canCopy: w.isActive && t.status === 'SUCCESS',
        recommendedVenue:
          dexVenue === 'Phoenix CLOB' || dexVenue === 'Titan Meta-DEX'
            ? dexVenue
            : 'Titan Meta-DEX',
        estimatedDelayMs: 65 + (Number(t.slot) % 70),
        targetSwapAmountUsd: Math.round((amountUsd ?? 0) * w.allocationWeight.toNumber()),
      },
    };
  }
}
