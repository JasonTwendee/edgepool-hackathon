import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { SolanaOnChainListenerService } from './solana.service.js';

const WATCHDOG_INTERVAL_MS = 30000;
const WATCHDOG_STALE_MS = 120000;

/**
 * WebSocket event stream (primary real-time source): one `onLogs` subscription
 * per tracked wallet. The 60s RPC sync in SyncModule is the safety net —
 * anything the socket misses (drop, 429, restart gap) is caught up by cursor.
 * Watchdog resubscribes when the socket goes quiet.
 */
@Injectable()
export class SolanaStreamService implements OnModuleInit, OnModuleDestroy {
  private subs = new Map<string, number>();
  private handler: ((address: string) => void) | null = null;
  private watchdog?: NodeJS.Timeout;
  private lastMsgAt = 0;

  constructor(
    @Inject(SolanaOnChainListenerService)
    private readonly solana: SolanaOnChainListenerService,
  ) {}

  onModuleInit(): void {
    void this.watchAll();
    this.watchdog = setInterval(() => void this.checkHealth(), WATCHDOG_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    for (const subId of this.subs.values()) {
      this.solana
        .getConnection()
        .removeOnLogsListener(subId)
        .catch(() => undefined);
    }
    this.subs.clear();
  }

  /** Pipeline callback: invoked with the wallet address on every log event. */
  setHandler(cb: (address: string) => void): void {
    this.handler = cb;
  }

  async watchAll(): Promise<void> {
    const wallets = this.solana.getTrackedWallets();
    // eslint-disable-next-line no-console
    console.log(`[SolanaStream] Subscribing onLogs for ${wallets.length} wallets…`);
    for (const w of wallets) {
      await this.watch(w.address);
      await new Promise((r) => setTimeout(r, 200));
    }
    // eslint-disable-next-line no-console
    console.log(`[SolanaStream] Active subscriptions: ${this.subs.size}`);
  }

  async watch(address: string): Promise<void> {
    if (this.subs.has(address)) return;
    try {
      const subId = await this.solana.getConnection().onLogs(
        new PublicKey(address),
        () => {
          this.lastMsgAt = Date.now();
          this.handler?.(address);
        },
        'confirmed',
      );
      this.subs.set(address, subId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[SolanaStream] subscribe ${address.slice(0, 8)}… failed:`, (err as Error).message);
    }
  }

  async unwatch(address: string): Promise<void> {
    const subId = this.subs.get(address);
    if (subId === undefined) return;
    this.subs.delete(address);
    try {
      await this.solana.getConnection().removeOnLogsListener(subId);
    } catch {
      // already gone — ignore
    }
  }

  private async checkHealth(): Promise<void> {
    if (this.subs.size === 0) return;
    if (Date.now() - this.lastMsgAt < WATCHDOG_STALE_MS) return;
    // eslint-disable-next-line no-console
    console.warn('[SolanaStream] Socket quiet >120s — resubscribing all wallets.');
    this.subs.clear();
    await this.watchAll();
  }
}
