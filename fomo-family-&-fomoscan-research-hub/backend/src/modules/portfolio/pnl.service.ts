import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { OnChainTransactionEvent } from '../onchain/entities/onchain-event.entity.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { FomoscanService } from '../../common/fomoscan/fomoscan.service.js';

export interface SymbolPnl {
  symbol: string;
  pairs: number;
  pnlUsd: number;
}

export interface PnlPoint {
  t: number;
  cum: number;
}

export interface WalletPnl {
  wallet: string;
  days: number;
  realizedPnlUsd: number;
  pairs: number;
  matchedSells: number;
  totalSells: number;
  totalBuys: number;
  /** Profitable pairs / total pairs (null when no pairs). */
  winRate: number | null;
  perSymbol: SymbolPnl[];
  /** Cumulative realized curve (at each matched sell) for the chart. */
  series: PnlPoint[];
  /** Top-5 in-window swaps by USD (feeds the profile header without an extra ledger fetch). */
  topTrades: OnChainTransactionEvent[];
}

/** Sells below this proceeds are dust disposals, not closes (see methodology). */
const DUST_PROCEEDS_USD = 1;

/**
 * Realized PnL estimate by quantity-aware FIFO buy→sell pairing, per symbol.
 *
 * Methodology (documented estimate, NOT on-chain exact):
 * - Cost basis uses FULL history: buys before the window still fund later
 *   sells (otherwise a $2M sell matched against in-window dust shows +$2M
 *   of thin air). Only pairs closed inside the window count toward
 *   realized/pairs/series/perSymbol.
 * - Each SELL consumes the oldest unmatched BUY lots of the same mint
 *   proportionally: profit = proceeds − Σ lot_cost × (filled_qty / lot_qty).
 * - Dust disposals (proceeds < $1 — ATA closures, rent reclamation) are NOT
 *   treated as closes: booking a dust sale would realize the entire
 *   remaining cost at once and crater the curve.
 * - Sells with no prior unmatched lots (or no qty/usd) are skipped.
 * - Leftover buys are open positions — ignored (no price feed for unrealized).
 * - Amounts come from Helius-parsed transfers (`helius` rows) or RPC heuristics.
 * - winRate = profitable matched sells / matched sells.
 */
@Injectable()
export class PnlService {
  constructor(
    @Inject(TransactionsService) private readonly tx: TransactionsService,
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FomoscanService) private readonly fomoscan: FomoscanService,
  ) {}

  private cutoffSec(days: number): number {
    return Math.floor(Date.now() / 1000) - days * 86400;
  }

  async getWalletPnl(walletAddress: string, days = 30): Promise<WalletPnl> {
    const cutoff = this.cutoffSec(days);
    // Full history rows: pre-window buys seed cost basis (see methodology).
    const rows = await this.tx.getRange(walletAddress, 0);

    interface Lot {
      qty: number;
      usd: number;
    }
    const buyQueues = new Map<string, Lot[]>();
    let realized = 0;
    let pairs = 0;
    let profitable = 0;
    let totalBuys = 0;
    let totalSells = 0;
    const perSymbol = new Map<string, { pairs: number; pnlUsd: number }>();
    const series: PnlPoint[] = [];

    for (const t of rows) {
      const usd = t.amountUsd ?? 0;
      const qty = t.amountToken ?? 0;
      const inWindow = t.blockTime >= cutoff;
      // Lots keyed by MINT, not symbol: scam clones reuse tickers
      // ($Anthropic = 97 mints, $GOOGL = 49) and symbol-keyed FIFO
      // fabricates giant fake pairs across unrelated tokens.
      const lotKey = t.tokenMint ?? t.symbol;
      if (t.action === 'BUY') {
        if (inWindow) totalBuys++;
        if (usd > 0 && qty > 0) {
          const q = buyQueues.get(lotKey) ?? [];
          q.push({ qty, usd });
          buyQueues.set(lotKey, q);
        }
      } else if (t.action === 'SELL') {
        if (inWindow) totalSells++;
        if (usd < DUST_PROCEEDS_USD || qty <= 0) continue;
        const q = buyQueues.get(lotKey);
        if (!q || q.length === 0) continue; // no cost basis — skip
        let remaining = qty;
        let cost = 0;
        while (remaining > 0 && q.length > 0) {
          const lot = q[0];
          const fill = Math.min(remaining, lot.qty);
          cost += (lot.usd * fill) / lot.qty;
          lot.qty -= fill;
          lot.usd -= (lot.usd * fill) / (lot.qty + fill);
          remaining -= fill;
          if (lot.qty <= 0) q.shift();
        }
        const filled = qty - remaining;
        if (filled <= 0) continue;
        if (!inWindow) continue; // basis consumed, profit belongs outside the window
        const proceeds = (usd * filled) / qty;
        const profit = proceeds - cost;
        realized += profit;
        pairs++;
        if (profit > 0) profitable++;
        series.push({ t: t.blockTime, cum: Math.round(realized * 100) / 100 });
        const agg = perSymbol.get(t.symbol) ?? { pairs: 0, pnlUsd: 0 };
        agg.pairs++;
        agg.pnlUsd += profit;
        perSymbol.set(t.symbol, agg);
      }
    }

    return {
      wallet: walletAddress,
      days,
      realizedPnlUsd: Math.round(realized),
      pairs,
      matchedSells: pairs,
      totalSells,
      totalBuys,
      winRate: pairs > 0 ? (profitable / pairs) * 100 : null,
      perSymbol: [...perSymbol.entries()]
        .map(([symbol, v]) => ({ symbol, pairs: v.pairs, pnlUsd: Math.round(v.pnlUsd) }))
        .sort((a, b) => b.pnlUsd - a.pnlUsd),
      series,
      topTrades: rows
        .filter(
          (t) =>
            t.blockTime >= cutoff &&
            (t.action === 'BUY' || t.action === 'SELL') &&
            (t.amountUsd ?? 0) > 0,
        )
        .sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0))
        .slice(0, 5),
    };
  }

  async getOverview(days = 30): Promise<WalletPnl[]> {
    // P2 fast-path: one batch FomoScan call for all handled wallets instead of
    // N full-ledger FIFO recomputes. METHODOLOGY DIFFERS from local FIFO
    // (their whole-wallet net vs our matched-pair realized) — gated behind
    // FOMOSCAN_PNL_PRIMARY (default false), any failure falls back to local.
    if (process.env.FOMOSCAN_PNL_PRIMARY === 'true' && this.fomoscan.enabled()) {
      try {
        return await this.getOverviewFast(days);
      } catch {
        // fall through to local FIFO
      }
    }
    const wallets = await this.wallets.findAll();
    return Promise.all(wallets.map((w) => this.getWalletPnl(w.address, days)));
  }

  private pickWindow(windows: Record<string, unknown>, days: number): string | null {
    // FomoScan windows vary (24h/7d/30d[/all]) — pick the largest window that
    // does not exceed the requested range; never invent a wider one.
    const span: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, all: 36500 };
    const avail = Object.keys(windows).filter((w) => w in span).sort((a, b) => span[a] - span[b]);
    let best: string | null = null;
    for (const w of avail) {
      if (span[w] <= days) best = w;
    }
    return best;
  }

  private async getOverviewFast(days: number): Promise<WalletPnl[]> {
    const wallets = await this.wallets.findAll();
    const handled = wallets.filter((w) => (w.handle ?? '').trim());
    const batch = await this.fomoscan.batchPnl(handled.map((w) => w.handle));
    const byHandle = new Map(batch.entries.map((e) => [e.handle.toLowerCase(), e]));
    return Promise.all(
      wallets.map(async (w) => {
        const entry = byHandle.get((w.handle ?? '').toLowerCase());
        const win = entry ? this.pickWindow(entry.windows ?? {}, days) : null;
        const wdata = win ? entry.windows?.[win] : undefined;
        // No handle, no suitable window, or not ready → local FIFO for this wallet.
        if (!wdata || entry.status !== 'ready') return this.getWalletPnl(w.address, days);
        return {
          wallet: w.address,
          days,
          realizedPnlUsd: Math.round(wdata.netUsd),
          pairs: wdata.trades,
          matchedSells: wdata.sells,
          totalSells: wdata.sells,
          totalBuys: wdata.buys,
          winRate: wdata.tokensTraded > 0 ? (wdata.winningTokens / wdata.tokensTraded) * 100 : null,
          perSymbol: [],
          series: [],
          topTrades: [],
        };
      }),
    );
  }

  /**
   * Cross-check one wallet: local FIFO realized vs FomoScan whole-wallet net.
   * Read-only ops tool (ADMIN controller route) — informs the PRIMARY flip,
   * never switches anything by itself.
   */
  async compare(walletAddress: string, days = 30): Promise<{
    wallet: string;
    handle: string | null;
    localRealizedUsd: number;
    fomoscanNetUsd: number | null;
    fomoscanWindow: string;
    deltaUsd: number | null;
  }> {
    const clean = (walletAddress ?? '').trim();
    const tracked = await this.wallets.findByAddress(clean);
    if (!tracked) throw new Error(`Wallet is not tracked: ${clean}.`);
    const local = await this.getWalletPnl(clean, days);
    const handle = (tracked.handle ?? '').trim() || null;
    if (!handle) {
      return { wallet: clean, handle, localRealizedUsd: local.realizedPnlUsd, fomoscanNetUsd: null, fomoscanWindow: '', deltaUsd: null };
    }
    const remote = await this.fomoscan.getPnl(handle);
    const win = this.pickWindow(remote.windows ?? {}, days);
    const net = win ? remote.windows?.[win]?.netUsd ?? null : null;
    return {
      wallet: clean,
      handle,
      localRealizedUsd: local.realizedPnlUsd,
      fomoscanNetUsd: net === null ? null : Math.round(net),
      fomoscanWindow: win ?? '',
      deltaUsd: net === null ? null : Math.round(local.realizedPnlUsd - net),
    };
  }

  /**
   * Recompute wallet stats from the real ledger (kills static seeds over time).
   * Only overwrites when the wallet has ≥1 paired trade; otherwise the seed
   * stays and the UI keeps showing the "seed" badge.
   * Returns the number of wallets updated.
   */
  async syncWalletStats(days = 30): Promise<number> {
    const wallets = await this.wallets.findAll();
    let updated = 0;
    for (const w of wallets) {
      const pnl = await this.getWalletPnl(w.address, days);
      if (pnl.pairs === 0) continue;
      await this.prisma.trackedWallet.updateMany({
        where: { address: w.address },
        data: {
          cumulativePnlUsd: pnl.realizedPnlUsd,
          winRate: pnl.winRate ?? undefined,
        },
      });
      updated++;
    }
    return updated;
  }
}
