import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { SolanaOnChainListenerService } from './solana.service.js';

const WATCHDOG_INTERVAL_MS = 30000;
/**
 * A 5-wallet basket can legitimately be quiet for a long time. Treating
 * normal inactivity as a dead socket caused a resubscribe storm every 2 min
 * in the old 30-wallet setup; 30 min is a safer death signal.
 */
const WATCHDOG_STALE_MS = (() => {
  const n = Number(process.env.LIVE_WATCHDOG_STALE_MS ?? 1800000);
  return Number.isFinite(n) && n > 0 ? n : 1800000;
})();

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
    // Subscriptions are owned by WalletsService.reconcileLiveStream (pool
    // roster). Do not bulk-subscribe hardcoded defaults here: the old boot
    // race re-added 10 non-pool wallets after the scope reconcile.
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

  /**
   * Make the subscription set exactly `addresses`. Called by the wallet
   * reconcile loop (live pool roster), so removing a trader immediately frees
   * its RPC slot and adding one starts streaming without a restart.
   */
  async resetTo(addresses: string[]): Promise<void> {
    const want = new Set(addresses);
    for (const address of [...this.subs.keys()]) {
      if (!want.has(address)) await this.unwatch(address);
    }
    for (const address of want) await this.watch(address);
    // eslint-disable-next-line no-console
    console.log(`[SolanaStream] live scope: ${want.size} wallet(s), subs=${this.subs.size}`);
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
    console.warn('[SolanaStream] Socket quiet > stale threshold — resubscribing live wallets.');
    // Unsubscribe properly (old code cleared the map and leaked listeners).
    for (const address of [...this.subs.keys()]) await this.unwatch(address);
    await this.watchAll();
  }
}
