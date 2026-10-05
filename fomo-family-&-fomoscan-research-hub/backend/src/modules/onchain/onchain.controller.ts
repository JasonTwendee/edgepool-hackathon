import { Controller, Get, Inject, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SSE_HEARTBEAT_MS } from '../../config/solana.config.js';
import { OnchainService } from './onchain.service.js';

interface SseDataMessage {
  data: unknown;
}

@Controller('api/onchain')
export class OnchainController {
  constructor(@Inject(OnchainService) private readonly onchain: OnchainService) {}

  @Sse('stream')
  stream(): Observable<SseDataMessage> {
    return new Observable<SseDataMessage>((observer) => {
      observer.next({
        data: {
          type: 'CONNECTED',
          message: 'SSE Stream Active - Listening to Solana on-chain swaps',
          timestamp: Date.now(),
        },
      });

      const unsubscribe = this.onchain.subscribe((event) => {
        observer.next({ data: { type: 'ONCHAIN_SWAP_EVENT', event } });
      });

      const heartbeat = setInterval(() => {
        observer.next({ data: { type: 'PING', timestamp: Date.now() } });
      }, SSE_HEARTBEAT_MS);

      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }

  @Get('events')
  async listEvents(@Query() rawQuery: Record<string, unknown>) {
    const wallet =
      typeof rawQuery.wallet === 'string' && rawQuery.wallet.length > 0
        ? rawQuery.wallet
        : undefined;
    const rawLimit = rawQuery.limit;
    const parsed =
      typeof rawLimit === 'string' ? parseInt(rawLimit, 10) : Number(rawLimit ?? 20);
    const limit = Number.isFinite(parsed) ? parsed : 20;
    const data = await this.onchain.listEvents(wallet, limit);
    return { success: true, total: data.length, data };
  }
}
