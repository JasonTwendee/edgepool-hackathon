import { Inject, Injectable } from '@nestjs/common';
import type { ConfirmedSignatureInfo } from '@solana/web3.js';
import type { TrackedWallet } from '../../server/solana.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  DexVenue,
  OnChainTransactionEvent,
} from '../onchain/entities/onchain-event.entity.js';
import { HeliusService, type HeliusParsedTx } from './helius.service.js';

export interface EnrichedPartial {
  action: OnChainTransactionEvent['action'];
  symbol: string;
  tokenMint?: string;
  amountToken?: number;
  amountUsd?: number;
  dexVenue: DexVenue;
  status: 'SUCCESS' | 'FAILED';
  feeSol: number;
}

const VENUE_BY_SOURCE: Array<[RegExp, DexVenue]> = [
  [/pump/i, 'Pump.fun'],
  [/raydium/i, 'Raydium AMM'],
  [/orca/i, 'Orca Whirlpool'],
  [/phoenix/i, 'Phoenix CLOB'],
  [/jupiter/i, 'Jupiter Aggregator'],
];

/** Parallel metadata fan-out (DexScreener/Jupiter tolerate this easily). */
const METAS_CONCURRENCY = Math.max(1, Number(process.env.HELIUS_META_CONCURRENCY ?? 10) || 10);

/** Pool-scope cache TTL: trader-set membership changes rarely. */
const SCOPE_TTL_MS = 5 * 60 * 1000;

/** Keep fractional USD (cents); sub-cent values are treated as unknown. */
function toUsdOrUndefined(usd: number): number | undefined {
  if (!Number.isFinite(usd) || usd < 0.01) return undefined;
  return Math.round(usd * 100) / 100;
}

/**
 * Turns Helius parsed transactions into ledger rows. Direction comes from
 * actual fund flow (wallet receives token = BUY, sends = SELL); amounts from
 * the counter-leg (usually SOL) or token qty × price. Falls back to null
 * (caller persists a minimal UNKNOWN row) when unparseable.
 */
@Injectable()
export class EnrichService {
  constructor(
    @Inject(HeliusService) private readonly helius: HeliusService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private scopeCache: { at: number; wallets: Set<string> } | null = null;

  /**
   * Helius-worthy wallets: active trader-set members (the only wallets whose
   * swaps can become pool signals). Everything else classifies via the free
   * pure-RPC fallback — a free-tier key cannot cover the full firehose.
   */
  async poolScope(): Promise<Set<string>> {
    if (this.scopeCache && Date.now() - this.scopeCache.at < SCOPE_TTL_MS) {
      return this.scopeCache.wallets;
    }
    const rows = await this.prisma.vaultTrader.findMany({
      where: { isActive: true },
      select: { wallet: true },
    });
    const wallets = new Set(rows.map((r) => r.wallet as string));
    this.scopeCache = { at: Date.now(), wallets };
    return wallets;
  }

  async enrichMany(
    walletAddress: string,
    sigs: ConfirmedSignatureInfo[],
  ): Promise<Map<string, EnrichedPartial>> {
    const out = new Map<string, EnrichedPartial>();
    if (!this.helius.isEnabled() || sigs.length === 0) return out;
    try {
      // Scope gate: off-scope wallets skip Helius spend entirely (the RPC
      // fallback still classifies their live swaps for free).
      if (!(await this.poolScope()).has(walletAddress)) return out;
    } catch {
      return out; // scope lookup must never break ingestion
    }
    const parsed = await this.helius.parseTransactions(sigs.map((s) => s.signature));

    const mints = new Set<string>([this.helius.getWsolMint()]);
    for (const t of parsed.values()) {
      for (const tr of t.tokenTransfers ?? []) {
        if (
          tr.mint &&
          (tr.fromUserAccount === walletAddress || tr.toUserAccount === walletAddress)
        ) {
          mints.add(tr.mint);
        }
      }
    }
    // Mint metadata fetched in parallel batches — a fresh whale wallet can
    // hold hundreds of unknown mints and sequential fetching stalls the
    // whole 20s sync loop behind the first wallets.
    const metas = new Map<string, { symbol: string; priceUsd: number }>();
    const mintArr = [...mints];
    for (let i = 0; i < mintArr.length; i += METAS_CONCURRENCY) {
      const slice = mintArr.slice(i, i + METAS_CONCURRENCY);
      const batch = await Promise.all(slice.map((m) => this.helius.getTokenMeta(m)));
      batch.forEach((meta, j) => {
        if (meta) metas.set(slice[j], meta);
      });
    }
    for (const [sig, t] of parsed) {
      const partial = this.buildPartial(walletAddress, t, metas);
      if (partial) out.set(sig, partial);
    }
    return out;
  }

  private mapVenue(source?: string): DexVenue {
    if (!source) return 'Solana Native';
    for (const [re, venue] of VENUE_BY_SOURCE) {
      if (re.test(source)) return venue;
    }
    return 'Solana Native';
  }

  private buildPartial(
    wallet: string,
    t: HeliusParsedTx,
    metas: Map<string, { symbol: string; priceUsd: number }>,
  ): EnrichedPartial | null {
    const status = t.transactionError ? 'FAILED' : 'SUCCESS';
    const feeSol = (t.fee ?? 0) / 1e9;
    const venue = this.mapVenue(t.source);
    const solPrice = metas.get(this.helius.getWsolMint())?.priceUsd ?? 0;

    const tokenLegs = (t.tokenTransfers ?? []).filter(
      (tr) => tr.fromUserAccount === wallet || tr.toUserAccount === wallet,
    );
    let solIn = 0;
    let solOut = 0;
    for (const n of t.nativeTransfers ?? []) {
      if (n.toUserAccount === wallet) solIn += n.amount ?? 0;
      if (n.fromUserAccount === wallet) solOut += n.amount ?? 0;
    }

    if (tokenLegs.length > 0) {
      const leg = tokenLegs.reduce((a, b) => ((b.tokenAmount ?? 0) > (a.tokenAmount ?? 0) ? b : a));
      const qty = leg.tokenAmount ?? 0;
      const incoming = leg.toUserAccount === wallet;
      const meta = leg.mint ? metas.get(leg.mint) : undefined;
      const symbol = meta?.symbol ?? (leg.mint ? `$${leg.mint.slice(0, 4)}` : '$UNKNOWN');
      // Value the counter-leg first (what was paid/received), else qty × price.
      let counterUsd = (incoming ? solOut / 1e9 : solIn / 1e9) * solPrice;
      if (counterUsd <= 0) {
        for (const other of tokenLegs) {
          if (other === leg || !other.mint) continue;
          const m = metas.get(other.mint);
          const isOut = other.fromUserAccount === wallet;
          if ((incoming && isOut) || (!incoming && !isOut)) {
            counterUsd += (other.tokenAmount ?? 0) * (m?.priceUsd ?? 0);
          }
        }
      }
      if (counterUsd <= 0) {
        // Pump.fun-style fills: the wallet has no direct SOL transfer leg
        // (a relayer/bonding-curve account moves the lamports). Fall back to
        // the wallet's net native balance change from accountData.
        counterUsd = this.accountDataCounterUsd(wallet, t, incoming, solPrice);
      }
      const qtyUsd = qty * (meta?.priceUsd ?? 0);
      const usd = counterUsd > 0 ? counterUsd : qtyUsd;
      return {
        action: incoming ? 'BUY' : 'SELL',
        symbol,
        tokenMint: leg.mint,
        amountToken: qty,
        amountUsd: toUsdOrUndefined(usd),
        dexVenue: venue,
        status,
        feeSol,
      };
    }

    // SOL-only flow.
    const netLamports = solIn - solOut;
    if (netLamports === 0) return null;
    const solQty = Math.abs(netLamports) / 1e9;
    const usd = solQty * solPrice;
    return {
      action: 'TRANSFER',
      symbol: '$SOL',
      amountToken: solQty,
      amountUsd: toUsdOrUndefined(usd),
      dexVenue: venue,
      status,
      feeSol,
    };
  }

  /**
   * Net native SOL flow for the wallet from Helius accountData. Covers fills
   * where lamports move via a bonding-curve/relayer account instead of a
   * direct wallet transfer leg (typical Pump.fun buys).
   */
  private accountDataCounterUsd(
    wallet: string,
    t: HeliusParsedTx,
    incoming: boolean,
    solPrice: number,
  ): number {
    if (solPrice <= 0) return 0;
    let net = 0;
    for (const a of t.accountData ?? []) {
      if (a.account === wallet) net += a.nativeBalanceChange ?? 0;
    }
    if (incoming && net < 0) return (-net / 1e9) * solPrice;
    if (!incoming && net > 0) return (net / 1e9) * solPrice;
    return 0;
  }

  /** Assemble the full API event from RPC sigInfo + optional enriched partial. */
  assembleEvent(
    wallet: TrackedWallet,
    sig: ConfirmedSignatureInfo,
    partial?: EnrichedPartial,
    source?: 'helius' | 'rpc-parser',
  ): OnChainTransactionEvent {
    const blockTime = sig.blockTime ?? Math.floor(Date.now() / 1000);
    const d = new Date(blockTime * 1000);
    const formattedTime =
      d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      ' ' +
      d.toLocaleDateString('vi-VN');
    const action = partial?.action ?? 'UNKNOWN';
    const symbol = partial?.symbol ?? '$SOL';
    const dexVenue = partial?.dexVenue ?? 'Solana Native';
    const status = partial ? partial.status : sig.err ? 'FAILED' : 'SUCCESS';
    const amountUsd = partial?.amountUsd;
    const canCopy =
      status === 'SUCCESS' && wallet.isCopyEnabled && action !== 'UNKNOWN';
    return {
      signature: sig.signature,
      slot: sig.slot,
      blockTime,
      formattedTime,
      wallet: wallet.address,
      walletName: `@${wallet.handle} (${wallet.label})`,
      source: source ?? (partial ? 'helius' : 'rpc'),
      action,
      symbol,
      tokenMint: partial?.tokenMint,
      amountToken: partial?.amountToken,
      amountUsd,
      dexVenue,
      slippageBps: 0,
      status,
      feeSol: partial?.feeSol ?? 0.000005,
      copySignal: {
        canCopy,
        recommendedVenue:
          dexVenue === 'Phoenix CLOB' || dexVenue === 'Titan Meta-DEX'
            ? dexVenue
            : 'Titan Meta-DEX',
        estimatedDelayMs: 65 + (sig.slot % 70),
        targetSwapAmountUsd: Math.round((amountUsd ?? 0) * wallet.allocationWeight),
      },
    };
  }
}
