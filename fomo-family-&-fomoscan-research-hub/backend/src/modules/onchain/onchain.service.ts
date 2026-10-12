import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  SolanaOnChainListenerService,
  type OnChainTransactionEvent,
} from '../../server/solana.service.js';
import { SolanaStreamService } from '../../server/solana-stream.service.js';
import { isStaleLiveEvent } from '../sync/history-sync.service.js';
import { EnrichService } from '../helius/enrich.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { TxParseService } from '../../common/chain/tx-parse.service.js';

export interface RealtimeEventDto {
  id: number;
  eventType: string;
  walletAddress: string;
  txSignature: string | null;
  title: string;
  payload: unknown;
  broadcastedAt: string;
}

/**
 * Live pipeline: WS stream delivers wallet activity instantly → fetch new
 * signatures → Helius enrich → persist ledger + realtime_events → SSE fan-out.
 * The 60s history sync is the safety net (cursor-based catch-up). Persistence
 * failures are logged, never crash the loop. In-flight guard per wallet.
 */
@Injectable()
export class OnchainService implements OnModuleInit {
  private inFlight = new Set<string>();

  constructor(
    @Inject(SolanaOnChainListenerService)
    private readonly solana: SolanaOnChainListenerService,
    @Inject(SolanaStreamService) private readonly stream: SolanaStreamService,
    @Inject(EnrichService) private readonly enrich: EnrichService,
    @Inject(TransactionsService) private readonly tx: TransactionsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TxParseService) private readonly rpcParse: TxParseService,
  ) {}

  onModuleInit(): void {
    this.stream.setHandler((address) => {
      void this.handleWalletActivity(address);
    });
  }

  /** Entry for push pipelines (Helius webhooks): same dedupe/enrich/persist/emit path as WS. */
  async ingestWalletActivity(address: string): Promise<void> {
    await this.handleWalletActivity(address);
  }

  subscribe(callback: (event: OnChainTransactionEvent) => void): () => void {
    return this.solana.subscribeEvents(callback);
  }

  private async handleWalletActivity(address: string): Promise<void> {
    if (this.inFlight.has(address)) return;
    this.inFlight.add(address);
    try {
      const wallet = this.solana.getTrackedWallets().find((w) => w.address === address);
      if (!wallet) return;
      // Dropped wallets stay subscribed on the socket: skip quietly instead
      // of crashing the batch on the ledger FK.
      const tracked = await this.prisma.trackedWallet
        .findUnique({ where: { address }, select: { address: true } })
        .catch(() => null);
      if (!tracked) return;
      const sigs = await this.solana.fetchSignatures(address, { limit: 10 });
      if (sigs.length === 0) return;
      const existing = await this.tx.getSignatures(address);
      const fresh = sigs.filter((s) => !existing.has(s.signature));
      if (fresh.length === 0) return;
      const enriched = await this.enrich.enrichMany(address, fresh);
      // WS delivery lands seconds after confirmation — inside the RPC
      // transaction-cache window — so the pure-RPC fallback actually resolves
      // here (the 2-minute safety-net sync usually arrives too late for it).
      const rpcParsed = await this.rpcParse.classifyFresh(address, fresh, new Set(enriched.keys()), 10);
      for (const s of fresh) {
        const rpc = rpcParsed.get(s.signature);
        const event = this.enrich.assembleEvent(wallet, s, enriched.get(s.signature) ?? rpc, rpc ? 'rpc-parser' : undefined);
        try {
          const inserted = await this.tx.recordTransaction(event, {
            source: 'ws-stream',
            enriched: event.source === 'helius',
          });
          if (!inserted || isStaleLiveEvent(event)) continue;
          await this.recordRealtimeEvent(event);
          this.solana.emitLive(event);
        } catch (err) {
          // One bad row (e.g. untracked wallet FK) must not kill the batch.
          // eslint-disable-next-line no-console
          console.error(`[OnchainService] live pipeline ${address.slice(0, 8)}… ${s.signature.slice(0, 8)}… failed:`, (err as Error).message);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[OnchainService] live pipeline ${address.slice(0, 8)}… failed:`, (err as Error).message);
    } finally {
      this.inFlight.delete(address);
    }
  }

  private async recordRealtimeEvent(event: OnChainTransactionEvent): Promise<void> {
    // The safety-net sync may have published this signature first — skip dupes.
    const existing = await this.prisma.realtimeEvent.findFirst({
      where: { txSignature: event.signature },
      select: { id: true },
    });
    if (existing) return;    const amount =
      event.amountUsd !== undefined ? ` $${event.amountUsd.toLocaleString('en-US')}` : '';
    await this.prisma.realtimeEvent.create({
      data: {
        eventType: 'ONCHAIN_SWAP_EVENT',
        walletAddress: event.wallet,
        txSignature: event.signature,
        title: `${event.action} ${event.symbol}${amount} on ${event.dexVenue} — ${event.walletName ?? event.wallet}`.slice(0, 200),
        payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue,
      },
    });
  }

  async listEvents(wallet?: string, limit = 20): Promise<RealtimeEventDto[]> {
    const rows = await this.prisma.realtimeEvent.findMany({
      where: wallet && wallet !== 'ALL' ? { walletAddress: wallet } : undefined,
      orderBy: { broadcastedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      walletAddress: r.walletAddress,
      txSignature: r.txSignature,
      title: r.title,
      payload: r.payload,
      broadcastedAt: r.broadcastedAt.toISOString(),
    }));
  }
}
