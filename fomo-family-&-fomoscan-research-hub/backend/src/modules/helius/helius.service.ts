import { Inject, Injectable } from '@nestjs/common';
import { getConfig } from '../../config/configuration.js';

export interface HeliusTokenTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  tokenAmount?: number;
  mint?: string;
}

export interface HeliusNativeTransfer {
  fromUserAccount?: string;
  toUserAccount?: string;
  amount?: number;
}

export interface HeliusAccountData {
  account: string;
  nativeBalanceChange: number;
}

export interface HeliusParsedTx {
  signature?: string;
  type?: string;
  source?: string;
  description?: string;
  fee?: number;
  slot?: number;
  transactionError?: unknown;
  tokenTransfers?: HeliusTokenTransfer[];
  nativeTransfers?: HeliusNativeTransfer[];
  accountData?: HeliusAccountData[];
}

export interface TokenMeta {
  symbol: string;
  priceUsd: number;
}

const FETCH_TIMEOUT_MS = 10000;
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
/** Parallel parse batches (Helius tolerates a few in flight). */
const PARSE_CONCURRENCY = 4;

/**
 * Helius API access (key from backend/.env — NEVER log it, never return it).
 * Disabled (empty-key) → callers fall back to heuristic rows tagged 'rpc'.
 */
@Injectable()
export class HeliusService {
  private metaCache = new Map<string, { meta: TokenMeta; at: number }>();
  private static META_TTL_MS = 5 * 60 * 1000;

  isEnabled(): boolean {
    return Boolean(getConfig().heliusApiKey);
  }

  private apiKey(): string {
    const key = getConfig().heliusApiKey;
    if (!key) throw new Error('HELIUS_API_KEY missing');
    return key;
  }

  /** Batch parse (≤100 signatures/call, a few calls in flight) → map by signature. Unknown sigs are absent. */
  async parseTransactions(signatures: string[]): Promise<Map<string, HeliusParsedTx>> {
    const out = new Map<string, HeliusParsedTx>();
    if (!this.isEnabled() || signatures.length === 0) return out;
    const batches: string[][] = [];
    for (let i = 0; i < signatures.length; i += 100) {
      batches.push(signatures.slice(i, i + 100));
    }
    for (let i = 0; i < batches.length; i += PARSE_CONCURRENCY) {
      const results = await Promise.all(batches.slice(i, i + PARSE_CONCURRENCY).map((b) => this.parseBatch(b)));
      for (const arr of results) {
        for (const t of arr) {
          if (t && t.signature) out.set(t.signature, t);
        }
      }
    }
    return out;
  }

  private async parseBatch(batch: string[]): Promise<HeliusParsedTx[]> {
    const res = await fetch(
      `https://api.helius.xyz/v0/transactions/?api-key=${encodeURIComponent(this.apiKey())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: batch }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as HeliusParsedTx[];
  }

  /** Mint → {symbol, priceUsd} via DAS getAsset, cached (price 5-min TTL). */
  async getTokenMeta(mint: string): Promise<TokenMeta | null> {
    if (!this.isEnabled()) return null;
    const cached = this.metaCache.get(mint);
    if (cached && Date.now() - cached.at < HeliusService.META_TTL_MS) return cached.meta;
    try {
      const url =
        getConfig().solanaRpcUrl.includes('helius')
          ? getConfig().solanaRpcUrl
          : 'https://api.helius.xyz/v0/';
      // DAS endpoint needs api-key when using the public URL; RPC URL already embeds it.
      const endpoint = url.includes('api-key')
        ? url
        : `${url.replace(/\/$/, '')}/?api-key=${encodeURIComponent(this.apiKey())}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'meta', method: 'getAsset', params: { id: mint } }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return cached?.meta ?? null;
      const json = (await res.json()) as {
        result?: {
          content?: { metadata?: { symbol?: string } };
          token_info?: { price_info?: { price_per_token?: number } };
        };
      };
      const symbol = json.result?.content?.metadata?.symbol;
      const price = json.result?.token_info?.price_info?.price_per_token;
      if (!symbol) return cached?.meta ?? null;
      const withPrefix = symbol.startsWith('$') ? symbol : `$${symbol}`;
      if (price && price > 0) {
        const meta = { symbol: withPrefix, priceUsd: price };
        this.metaCache.set(mint, { meta, at: Date.now() });
        return meta;
      }
      // DAS often has no price for fresh memecoins — fall back to DexScreener, then Jupiter.
      const dsPrice = await this.getDexScreenerPrice(mint);
      const jupPrice = !dsPrice ? await this.getJupiterPrice(mint) : null;
      const meta = { symbol: withPrefix, priceUsd: dsPrice ?? jupPrice ?? 0 };
      this.metaCache.set(mint, { meta, at: Date.now() });
      return meta;
    } catch {
      return cached?.meta ?? null;
    }
  }

  getWsolMint(): string {
    return WSOL_MINT;
  }

  /** Best-effort USD price for memecoins missing DAS price_info. No key needed. */
  private async getDexScreenerPrice(mint: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const arr = (await res.json()) as Array<{ priceUsd?: string }>;
      for (const p of arr ?? []) {
        const v = Number(p?.priceUsd);
        if (Number.isFinite(v) && v > 0) return v;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Second price fallback via Jupiter (free, no key). Parses defensively. */
  private async getJupiterPrice(mint: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.jup.ag/price/v3?ids=${mint}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as Record<string, unknown>;
      const candidates: unknown[] = [
        (json.data as Record<string, unknown> | undefined)?.[mint],
        json[mint],
      ];
      for (const c of candidates) {
        const v = Number((c as { usdPrice?: unknown } | null)?.usdPrice);
        if (Number.isFinite(v) && v > 0) return v;
      }
      return null;
    } catch {
      return null;
    }
  }
}
