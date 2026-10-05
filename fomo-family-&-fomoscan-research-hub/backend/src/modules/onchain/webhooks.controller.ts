import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { SolanaOnChainListenerService } from '../../server/solana.service.js';
import { OnchainService } from './onchain.service.js';

interface WebhookTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
}

interface WebhookTx {
  signature?: string;
  tokenTransfers?: WebhookTransfer[];
  nativeTransfers?: WebhookTransfer[];
}

/**
 * Helius webhook receiver (push real-time). Helius POSTs an array of enhanced
 * transactions; we match transfer counterparties against tracked wallets and
 * run each hit through the standard ingest pipeline (dedupe → enrich →
 * persist → realtime_events → SSE). Always ACKs fast; heavy work runs async.
 */
@Controller('api/webhooks')
export class WebhooksController {
  constructor(
    @Inject(OnchainService) private readonly onchain: OnchainService,
    @Inject(SolanaOnChainListenerService)
    private readonly solana: SolanaOnChainListenerService,
  ) {}

  @Post('helius')
  @HttpCode(200)
  receive(
    @Body() body: unknown,
    @Headers('authorization') auth: string | undefined,
  ): { success: boolean } {
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    if (secret && auth !== `Bearer ${secret}`) {
      // eslint-disable-next-line no-console
      console.warn('[Webhook] rejected delivery with bad auth header');
      return { success: false };
    }
    const txs = Array.isArray(body) ? (body as WebhookTx[]) : [body as WebhookTx];
    const tracked = new Set(this.solana.getTrackedWallets().map((w) => w.address));
    const hits = new Set<string>();
    for (const t of txs) {
      if (!t || typeof t !== 'object') continue;
      for (const tr of [...(t.tokenTransfers ?? []), ...(t.nativeTransfers ?? [])]) {
        if (tr.fromUserAccount && tracked.has(tr.fromUserAccount)) hits.add(tr.fromUserAccount);
        if (tr.toUserAccount && tracked.has(tr.toUserAccount)) hits.add(tr.toUserAccount);
      }
    }
    if (hits.size > 0) {
      // eslint-disable-next-line no-console
      console.log(`[Webhook] ${txs.length} tx(s) → ${hits.size} tracked wallet(s)`);
      setImmediate(() => {
        for (const addr of hits) void this.onchain.ingestWalletActivity(addr);
      });
    }
    return { success: true };
  }
}
