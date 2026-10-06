/**
 * Chain transport: RPC connection (HTTP + WS), tracked-wallet registry,
 * signature fetching with retry, and live-event fan-out.
 * No polling loop, no heuristics here — history sync lives in SyncModule,
 * enrichment in HeliusModule, persistence in TransactionsModule.
 */
import { Injectable } from '@nestjs/common';
import { Connection, PublicKey, type ConfirmedSignatureInfo } from '@solana/web3.js';

import type { OnChainTransactionEvent } from '../modules/onchain/entities/onchain-event.entity.js';

export type { OnChainTransactionEvent };

export interface TrackedWallet {
  address: string;
  label: string;
  handle: string;
  avatar?: string;
  totalPnlUsd?: number;
  winRate?: number;
  isCopyEnabled: boolean;
  allocationWeight: number;
  addedAt: string;
}

// Default list of master wallets from user's FOMO data
export const DEFAULT_TRACKED_WALLETS: TrackedWallet[] = [
  // Canonical 10 master wallets from FOMO leaderboard (user-provided 2026-09-29).
  // totalPnlUsd = FOMO all-time totalPnL; winRate recomputed from ledger pairs.
  {
    address: '2heJbC32Tpfcb3nbUb5ER61K11FGZVfVGtVnDm6LDogF',
    label: 'Unipcs',
    handle: 'unipcs',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/685a72bf4e0ab7095593e7618caa5c8e_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 11416891.98,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: 'Beqv6dzTcjV2eodo8RRXCiCcnSYrS1vkQKhfqwHXqeit',
    label: 'point farm capital',
    handle: 'pointfarmcap',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/94a0a2f625de8a39e48a26e750486a49_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 7351168.45,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: '5FGoPPj1nL8LCnfVnpTmreqQtqLuMXXAwuS1uahMrp8V',
    label: 'DumbCrayonEater',
    handle: 'DumbCrayonEater',
    totalPnlUsd: 6778978.64,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: '4ugDhHJ8XDXAeABmrNmGffFaLbJb9BkPyiFGVSV9ocwo',
    label: 'TheS◎Lstice',
    handle: 'The__Solstice',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/eb2964462438bba9a804412266799318_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 5351697.67,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: '2yXwy5Dsa1XtEXcsrkFVRJeyuWD3qKkMN3pP3p5VTW3V',
    label: 'Salem',
    handle: 'Salem1299534',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/3d08ecc37973844cc48b046b4efdb655_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 5312719.03,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: 'F5hkYsi8JxjyA2JHN5CA7MbnnhWubkXB2ZQB7Gkaxqs6',
    label: 'Vee',
    handle: 'theveeman',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/95b880cf651ea5deae0d7ca986b71fa5_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 4710812.68,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: 'H2QSGECp13sFLJgdTsDtayX3dk18Dm6sQMSQKcew7Xzk',
    label: 'AJC',
    handle: 'AvgJoesCrypto',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/be589800533de1c866a58c639a35e9db_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 4227970.78,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: '498g1rVnFcnjBjpfw1xyqA1WvgQXUU8RWuELjxkjAayQ',
    label: 'frank 🎒',
    handle: 'frankdegods',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/b099ba0c0f4f5809c7be5d65fb30b72e_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 3822514.81,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: 'DCeH3aCsstGUSxQqS72VBZwTydoor1nQ6dWaxrgGQk39',
    label: 'Nate',
    handle: 'Natan_benish',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/8857bcd69bb2b2993fc911ce5cecaf09_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 3746813.69,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  },
  {
    address: '9wMSNoA7TzhwUjqsACVGEvzAxAibCHnsZTgXEAGov8zQ',
    label: 'Frogman',
    handle: 'frogmanhaha',
    avatar: 'https://prod-fomo-profile-pics.s3.amazonaws.com/ca2c588488d610de4c37b8f0a915fe68_small.jpg?k=272mA41OLe2wfMNpVCBlFp8Cg',
    totalPnlUsd: 3686064.48,
    isCopyEnabled: true,
    allocationWeight: 1.0,
    addedAt: '2026-09-29'
  }
];

@Injectable()
export class SolanaOnChainListenerService {
  private readonly connection: Connection;
  /**
   * Archive connection for history: the base tier truncates
   * getSignaturesForAddress (empty pages), Helius keeps full history.
   * Falls back to the main connection when no key is configured.
   */
  private readonly historyConnection: Connection;
  private trackedWallets: Map<string, TrackedWallet> = new Map();
  private eventListeners: Array<(event: OnChainTransactionEvent) => void> = [];

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    // Helius serves WS on the same host (https→wss); override via SOLANA_WS_URL when needed.
    const wsEndpoint =
      process.env.SOLANA_WS_URL || rpcUrl.replace(/^http/, 'ws');
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      wsEndpoint,
    });
    const heliusKey = process.env.HELIUS_API_KEY || undefined;
    this.historyConnection = heliusKey
      ? new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
        commitment: 'confirmed',
      })
      : this.connection;

    // Initialize with default wallets
    DEFAULT_TRACKED_WALLETS.forEach(w => {
      this.trackedWallets.set(w.address, w);
    });
  }

  public getConnection(): Connection {
    return this.connection;
  }

  public getTrackedWallets(): TrackedWallet[] {
    return Array.from(this.trackedWallets.values());
  }

  public addTrackedWallet(wallet: TrackedWallet): void {
    // Validate Solana address format
    try {
      new PublicKey(wallet.address);
      this.trackedWallets.set(wallet.address, wallet);
    } catch {
      throw new Error(`Invalid Solana wallet address: ${wallet.address}`);
    }
  }

  public removeTrackedWallet(address: string): boolean {
    return this.trackedWallets.delete(address);
  }

  public updateWalletCopyConfig(address: string, isCopyEnabled: boolean, allocationWeight?: number): boolean {
    const existing = this.trackedWallets.get(address);
    if (!existing) return false;
    existing.isCopyEnabled = isCopyEnabled;
    if (allocationWeight !== undefined) {
      existing.allocationWeight = allocationWeight;
    }
    this.trackedWallets.set(address, existing);
    return true;
  }

  public subscribeEvents(callback: (event: OnChainTransactionEvent) => void): () => void {
    this.eventListeners.push(callback);
    return () => {
      this.eventListeners = this.eventListeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Fetch a page of signatures for a wallet (newest first), with retry and
   * backoff so transient RPC failures (429) don't kill the sync/stream.
   * Returns [] (no throw) after retries are exhausted — callers treat empty
   * as "try again next cycle".
   */
  public async fetchSignatures(
    address: string,
    opts: { limit: number; before?: string; until?: string },
  ): Promise<ConfirmedSignatureInfo[]> {
    const pubkey = new PublicKey(address);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.historyConnection.getSignaturesForAddress(pubkey, {
          limit: opts.limit,
          ...(opts.before ? { before: opts.before } : {}),
          ...(opts.until ? { until: opts.until } : {}),
        });
      } catch (err) {
        lastErr = err;
        const delayMs = 500 * 2 ** attempt;
        // eslint-disable-next-line no-console
        console.warn(
          `[SolanaRPC] ${address.slice(0, 8)}… attempt ${attempt + 1}/4 failed, retry in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    // eslint-disable-next-line no-console
    console.error(`[SolanaRPC] ${address.slice(0, 8)}… giving up:`, (lastErr as Error)?.message);
    return [];
  }

  /** Broadcast a live event to SSE subscribers (called by the stream pipeline). */
  public emitLive(event: OnChainTransactionEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SolanaListener] Error in event listener callback:', err);
      }
    }
  }
}
