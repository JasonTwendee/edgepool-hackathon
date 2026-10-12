import { Inject, Injectable } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { getReadRpcUrl, SOLANA_COMMITMENT } from '../../config/solana.config.js';
import { DataStreamService } from '../market/datastream.service.js';
import type { EnrichedPartial } from '../../modules/helius/enrich.service.js';

export interface ParsedSwap {
  action: 'BUY' | 'SELL' | 'TRANSFER' | 'UNKNOWN';
  symbol: string;
  tokenMint?: string;
  amountToken?: number;
  amountUsd?: number;
  dexVenue: string;
  status: 'SUCCESS' | 'FAILED';
  feeSol: number;
}

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Venue from log markers (robust without hardcoding program ids). */
function venueFromLogs(logs: string[]): string {
  const all = logs.join('\n').toLowerCase();
  if (all.includes('jupiter')) return 'Jupiter Aggregator';
  if (all.includes('phoenix')) return 'Phoenix CLOB';
  if (all.includes('titan')) return 'Titan Meta-DEX';
  if (all.includes('raydium')) return 'Raydium AMM';
  if (all.includes('orca') || all.includes('whirlpool')) return 'Orca Whirlpool';
  if (all.includes('pump')) return 'Pump.fun';
  return 'Solana Native';
}

/**
 * Pure-RPC transaction parser (Helius-free path): getTransaction jsonParsed +
 * pre/post balance diffs + DataStream prices. Used to validate/replace the
 * Helius DAS enrich pipeline.
 */
@Injectable()
export class TxParseService {
  private connection: Connection | null = null;

  constructor(@Inject(DataStreamService) private readonly prices: DataStreamService) {}

  conn(): Connection {
    if (!this.connection) this.connection = new Connection(getReadRpcUrl(), SOLANA_COMMITMENT);
    return this.connection;
  }

  async parse(
    signature: string,
    wallet: string,
    connection: {
      getTransaction(sig: string, cfg: Record<string, unknown>): Promise<unknown>;
    } = this.conn() as unknown as {
      getTransaction(sig: string, cfg: Record<string, unknown>): Promise<unknown>;
    },
  ): Promise<ParsedSwap | null> {
    const tx = (await connection.getTransaction(signature, {
      commitment: 'confirmed',
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 1,
    })) as null | {
      meta?: {
        err?: unknown;
        fee?: number;
        logMessages?: string[];
        preBalances?: number[];
        postBalances?: number[];
        preTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null } }[];
        postTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null } }[];
      };
      transaction?: { message?: { accountKeys?: unknown } };
    };
    if (!tx?.meta) return null;
    const meta = tx.meta;
    const status = meta.err ? 'FAILED' : 'SUCCESS';
    const feeSol = (meta.fee ?? 5000) / 1e9;
    const keys: string[] =
      ((tx.transaction as unknown as { message?: { accountKeys?: unknown } })?.message?.accountKeys as { pubkey?: string; toString?: () => string }[] | undefined)?.map(
        (k) => (typeof k === 'string' ? k : (k?.pubkey ?? k?.toString?.() ?? '')),
      ) ?? [];
    const idx = keys.indexOf(wallet);
    if (idx < 0) return null;
    const solDelta = ((meta.postBalances?.[idx] ?? 0) - (meta.preBalances?.[idx] ?? 0)) / 1e9;

    // Aggregate per-mint token deltas for the wallet.
    const deltas = new Map<string, number>();
    const confidences = new Map<string, number>();
    const pre = new Map<string, number>();
    for (const b of meta.preTokenBalances ?? []) {
      if (b.owner !== wallet || !b.mint) continue;
      pre.set(b.mint, (b.uiTokenAmount?.uiAmount ?? 0) || 0);
    }
    for (const b of meta.postTokenBalances ?? []) {
      if (b.owner !== wallet || !b.mint) continue;
      const d = ((b.uiTokenAmount?.uiAmount ?? 0) || 0) - (pre.get(b.mint) ?? 0);
      if (d !== 0) {
        deltas.set(b.mint, (deltas.get(b.mint) ?? 0) + d);
        confidences.set(b.mint, (confidences.get(b.mint) ?? 0) + 1);
      }
    }
    void confidences;
    // Pick the largest absolute token flow as the trade leg.
    let mint: string | undefined;
    let qty = 0;
    for (const [m, d] of deltas) {
      if (Math.abs(d) > Math.abs(qty)) {
        mint = m;
        qty = d;
      }
    }
    const logs = meta.logMessages ?? [];
    const venue = venueFromLogs(logs);
    if (!mint || qty === 0) {
      // Pure SOL move (or no wallet token flow): TRANSFER with SOL delta.
      if (Math.abs(solDelta) < 1e-9) return null;
      return {
        action: 'TRANSFER',
        symbol: 'SOL',
        tokenMint: WSOL_MINT,
        amountToken: Math.abs(Math.round(solDelta * 1e9) / 1e9),
        amountUsd: undefined,
        dexVenue: venue,
        status,
        feeSol,
      };
    }
    // Token in + SOL out = BUY; token out + SOL in = SELL.
    const action = qty > 0 ? (solDelta < 0 ? 'BUY' : 'UNKNOWN') : solDelta > 0 ? 'SELL' : 'UNKNOWN';
    let amountUsd: number | undefined;
    try {
      const prices = await this.prices.bulkPrices([mint]);
      if (prices[mint] !== undefined) {
        amountUsd = Math.round(Math.abs(qty) * prices[mint] * 100) / 100;
      }
    } catch {
      amountUsd = undefined;
    }
    return {
      action,
      symbol: `$${mint.slice(0, 4)}`,
      tokenMint: mint,
      amountToken: Math.abs(Math.round(qty * 1e8) / 1e8),
      amountUsd,
      dexVenue: venue,
      status,
      feeSol,
    };
  }

  /**
   * Helius-free classification for fresh signatures another enricher didn't
   * cover. Only SUCCESSFUL swaps with an identified token leg become
   * signals — transfers, failures, and unparseable txs are skipped (the
   * caller keeps their minimal UNKNOWN rows). Bounded and fail-soft:
   * a parse failure must never break ingestion.
   */
  async classifyFresh(
    address: string,
    sigs: { signature: string }[],
    covered: Set<string>,
    budget = 30,
  ): Promise<Map<string, EnrichedPartial>> {
    const out = new Map<string, EnrichedPartial>();
    const missing = sigs.filter((s) => !covered.has(s.signature));
    for (const s of missing.slice(0, Math.max(0, budget))) {
      try {
        const p = await this.parse(s.signature, address);
        if (!p || p.status !== 'SUCCESS') continue;
        if ((p.action !== 'BUY' && p.action !== 'SELL') || !p.tokenMint) continue;
        out.set(s.signature, {
          action: p.action,
          symbol: p.symbol,
          tokenMint: p.tokenMint,
          amountToken: p.amountToken,
          amountUsd: p.amountUsd,
          dexVenue: p.dexVenue as EnrichedPartial['dexVenue'],
          status: p.status,
          feeSol: p.feeSol,
        });
      } catch {
        // Keep the UNKNOWN row.
      }
    }
    return out;
  }
}
