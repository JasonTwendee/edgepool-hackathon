import { Inject, Injectable } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { getReadRpcUrl, SOLANA_COMMITMENT } from '../../config/solana.config.js';
import { HeliusService } from '../helius/helius.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';

export interface HoldingToken {
  mint: string;
  symbol: string;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface WalletHoldings {
  wallet: string;
  asOf: string;
  solBalance: number;
  solPriceUsd: number | null;
  solValueUsd: number | null;
  totalValueUsd: number;
  tokens: HoldingToken[];
}

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** Whale wallets hold thousands of dust mints — price only the top balances. */
const MAX_PRICED_MINTS = 150;
/** Mint symbols are immutable — cache forever, avoids repeat DAS calls. */
const symbolCache = new Map<string, string>();

/**
 * Live token balances per wallet (SPL + Token-2022 + native SOL).
 * Reads go through the Lantern cache when configured (getReadRpcUrl) while
 * WS subscriptions stay on the main RPC. Pricing: DataStream bulk first,
 * Helius/DAS chain as fallback per missing mint.
 */
@Injectable()
export class HoldingsService {
  private readConnection: Connection | null = null;

  constructor(
    @Inject(HeliusService) private readonly helius: HeliusService,
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(DataStreamService) private readonly prices: DataStreamService,
  ) {}

  private connection(): Connection {
    if (!this.readConnection) {
      this.readConnection = new Connection(getReadRpcUrl(), SOLANA_COMMITMENT);
    }
    return this.readConnection;
  }

  async getHoldings(walletAddress: string): Promise<WalletHoldings> {
    const wallet = await this.wallets.findByAddress(walletAddress);
    if (!wallet) throw new Error(`Ví chưa được tracking: ${walletAddress}`);
    const owner = new PublicKey(walletAddress);
    const connection = this.connection();

    const emptyParsed = { context: { apiVersion: '', slot: 0 }, value: [] as never[] };
    const [lamports, ...parsed] = await Promise.all([
      connection.getBalance(owner, 'confirmed'),
      connection
        .getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(TOKEN_PROGRAM) })
        .catch(() => emptyParsed),
      connection
        .getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(TOKEN_2022_PROGRAM) })
        .catch(() => emptyParsed),
    ]);

    const byMint = new Map<string, number>();
    for (const res of parsed) {
      for (const acc of res.value) {
        const info = acc.account.data.parsed?.info;
        const mint: string | undefined = info?.mint;
        const amount: number = Number(info?.tokenAmount?.uiAmount ?? 0);
        if (!mint || !Number.isFinite(amount) || amount <= 0) continue;
        byMint.set(mint, (byMint.get(mint) ?? 0) + amount);
      }
    }

    const solBalance = lamports / 1e9;
    const ordered = [...byMint.entries()].sort((a, b) => b[1] - a[1]);
    const priceable = ordered.slice(0, MAX_PRICED_MINTS).map(([m]) => m);
    // DataStream bulk first (one call, includes wSOL), Helius per missing mint.
    const solMint = this.helius.getWsolMint();
    if (!symbolCache.has(solMint)) symbolCache.set(solMint, 'SOL');
    let bulk: Record<string, number> = {};
    try {
      bulk = await this.prices.bulkPrices([...new Set([...priceable, solMint])]);
    } catch {
      bulk = {};
    }
    const solMeta = await this.helius.getTokenMeta(solMint);
    const bulkSol = bulk[solMint];
    const solPriceUsd =
      bulkSol !== undefined && bulkSol > 0
        ? bulkSol
        : solMeta && solMeta.priceUsd > 0
          ? solMeta.priceUsd
          : null;
    const solValueUsd = solPriceUsd !== null ? round2(solBalance * solPriceUsd) : null;

    // Price top balances only — the long dust tail stays listed but unpriced.
    const metaMap = new Map<string, { symbol: string; priceUsd: number }>();
    for (let i = 0; i < priceable.length; i += 10) {
      const slice = priceable.slice(i, i + 10);
      const batch = await Promise.all(
        slice.map(async (m) => {
          // DataStream price + cached symbol: zero Helius calls.
          if (bulk[m] !== undefined && symbolCache.has(m)) {
            return { symbol: symbolCache.get(m) as string, priceUsd: bulk[m] };
          }
          const meta = await this.helius.getTokenMeta(m);
          if (!meta) {
            return bulk[m] !== undefined ? { symbol: '', priceUsd: bulk[m] } : null;
          }
          if (meta.symbol) symbolCache.set(m, meta.symbol);
          return { symbol: meta.symbol, priceUsd: bulk[m] ?? meta.priceUsd };
        }),
      );
      batch.forEach((meta, j) => {
        if (meta && (meta.priceUsd > 0 || meta.symbol)) metaMap.set(slice[j], meta);
      });
    }
    const tokens: HoldingToken[] = [];
    for (const [mint, balance] of ordered) {
      const meta = metaMap.get(mint);
      const priceUsd = meta && meta.priceUsd > 0 ? meta.priceUsd : null;
      tokens.push({
        mint,
        symbol: meta?.symbol ?? `$${mint.slice(0, 4)}`,
        balance: round2(balance),
        priceUsd,
        valueUsd: priceUsd !== null ? round2(balance * priceUsd) : null,
      });
    }
    tokens.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

    const totalValueUsd = round2(
      (solValueUsd ?? 0) + tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0),
    );
    return {
      wallet: walletAddress,
      asOf: new Date().toISOString(),
      solBalance: round2(solBalance),
      solPriceUsd,
      solValueUsd,
      totalValueUsd,
      tokens,
    };
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
