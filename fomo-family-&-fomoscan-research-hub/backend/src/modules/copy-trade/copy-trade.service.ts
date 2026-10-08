import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import { PrismaService } from '../../database/prisma.service.js';
import { getConfig } from '../../config/configuration.js';
import { generateRandomSignature } from '../../common/utils/signature.util.js';
import type { ExecuteCopyDto } from './dto/execute-copy.dto.js';
import {
  DEFAULT_SOL_MINT,
  DEFAULT_USDC_MINT,
  PaperExecutorService,
} from './paper-executor.service.js';
import { RugCheckService } from '../../common/rugcheck/rugcheck.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { VaultService } from '../vaults/vault.service.js';
import { remainingNotionalUsd } from '../../common/accounting/paper-position.js';
import { isHaltedVault } from './kill-switch.js';

export interface CopyRecord {
  id: string;
  masterHandle: string;
  masterWallet?: string;
  masterTxHash?: string;
  vaultTxHash: string;
  jitoBundleId: string;
  slotNumber: number;
  symbol: string;
  action: string;
  amountUsd: number;
  executionVenue: string;
  copyDelayMs: number;
  slippageBps: number;
  status: 'CONFIRMED';
  timestamp: string;
}

export interface CopyOrderShape {
  id: number;
  masterWallet?: string;
  masterHandle?: string;
  masterTxHash?: string;
  symbol?: string;
  action?: string;
  tokenMint?: string;
  amountUsd?: number;
  venue?: string;
  mode: 'paper';
  status: 'PENDING' | 'QUATED' | 'SENT' | 'CONFIRMED' | 'FAILED';
  devnetSignature?: string;
  error?: string;
  entryMode?: string;
  delayDragPct?: number;
  tp1Pct?: number;
  stopPct?: number;
  tp1ShareBps?: number | null;
  trailPct?: number | null;
  tp2MultPct?: number | null;
  entryPriceUsd?: number;
  peakPriceUsd?: number;
  exitPriceUsd?: number;
  closeReason?: string;
  closedAt?: string | null;
  realizedPnlUsd?: number;
  createdAt: string;
  /** TP ladder legs (additive, intent D-L3). Absent on legacy sim records. */
  legs?: { leg: string; fraction: number; exitPriceUsd?: number; realizedPnlUsd?: number; closedAt?: string | null }[];
}

export interface PaperOverrides {
  paperEnabled?: boolean;
  maxUsd?: number;
  executor?: PaperExecutorService;
  connection?: Connection;
  rugcheck?: Pick<RugCheckService, 'qualify'>;
  market?: Pick<DataStreamService, 'bulkPrices' | 'tokenDetails' | 'candles'>;
  strict?: boolean;
  /** T1 auto-fire: size against this vault (default 1) + tag the actor. */
  vaultId?: number;
  triggeredBy?: string;
}

function fail(message: string, extra?: Record<string, unknown>): never {
  throw new BadRequestException({ success: false, message, ...extra });
}

function toOrderShape(row: {
  id: number;
  masterWallet: string | null;
  masterHandle: string | null;
  masterTxHash: string | null;
  symbol: string | null;
  action: string | null;
  tokenMint: string | null;
  amountUsd: { toNumber(): number } | number | null;
  venue: string | null;
  mode: string;
  status: string;
  devnetSignature: string | null;
  error: string | null;
  entryMode: string;
  delayDragPct: { toNumber(): number } | number | null;
  tp1Pct: { toNumber(): number } | number | null;
  stopPct: { toNumber(): number } | number | null;
  tp1ShareBps: number | null;
  trailPct: number | null;
  tp2MultPct: number | null;
  entryPriceUsd: { toNumber(): number } | number | null;
  peakPriceUsd: { toNumber(): number } | number | null;
  exitPriceUsd: { toNumber(): number } | number | null;
  closeReason: string | null;
  closedAt: Date | null;
  realizedPnlUsd: { toNumber(): number } | number | null;
  createdAt: Date;
  legs?: {
    leg: string;
    fraction: { toNumber(): number } | number;
    exitPriceUsd: { toNumber(): number } | number | null;
    realizedPnlUsd: { toNumber(): number } | number | null;
    closedAt: Date | null;
  }[] | null;
}): CopyOrderShape {
  const num = (v: { toNumber(): number } | number | string | null | undefined): number | undefined => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    return v?.toNumber() ?? undefined;
  };
  return {
    id: row.id,
    masterWallet: row.masterWallet ?? undefined,
    masterHandle: row.masterHandle ?? undefined,
    masterTxHash: row.masterTxHash ?? undefined,
    symbol: row.symbol ?? undefined,
    action: row.action ?? undefined,
    tokenMint: row.tokenMint ?? undefined,
    amountUsd:
      typeof row.amountUsd === 'number' ? row.amountUsd : (row.amountUsd?.toNumber() ?? undefined),
    venue: row.venue ?? undefined,
    mode: 'paper',
    status: row.status as CopyOrderShape['status'],
    devnetSignature: row.devnetSignature ?? undefined,
    error: row.error ?? undefined,
    entryMode: row.entryMode,
    delayDragPct: num(row.delayDragPct),
    tp1Pct: num(row.tp1Pct),
    stopPct: num(row.stopPct),
    tp1ShareBps: row.tp1ShareBps ?? undefined,
    trailPct: row.trailPct ?? undefined,
    tp2MultPct: row.tp2MultPct ?? undefined,
    entryPriceUsd: num(row.entryPriceUsd),
    peakPriceUsd: num(row.peakPriceUsd),
    exitPriceUsd: num(row.exitPriceUsd),
    closeReason: row.closeReason ?? undefined,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    realizedPnlUsd: num(row.realizedPnlUsd),
    createdAt: row.createdAt.toISOString(),
    legs: (row.legs ?? []).map((l) => ({
      leg: l.leg,
      fraction: num(l.fraction) ?? 0,
      exitPriceUsd: num(l.exitPriceUsd),
      realizedPnlUsd: num(l.realizedPnlUsd),
      closedAt: l.closedAt ? l.closedAt.toISOString() : null,
    })),
  };
}

/**
 * SIMULATION ONLY (legacy) + devnet paper execution (1-click gated).
 * Protected module (see docs/ai/protected-files.md): real execution needs
 * Execution Keypair + Jito bundle + Vault PDA review + explicit approval.
 * Paper path never touches mainnet (genesis-checked inside the executor).
 */
@Injectable()
export class CopyTradeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaperExecutorService) private readonly paper: PaperExecutorService,
    @Inject(RugCheckService) private readonly rugs: RugCheckService,
    @Inject(DataStreamService) private readonly market: DataStreamService,
    @Inject(VaultService) private readonly vaults: VaultService,
  ) {}

  execute(dto: ExecuteCopyDto): CopyRecord {
    const vaultTxHash = generateRandomSignature();
    const jitoBundleId = 'bundle_jito_' + Math.random().toString(36).substring(2, 10);
    const slotNumber = 289108150 + Math.floor(Math.random() * 200);
    return {
      id: `copy-${Date.now()}`,
      masterHandle: dto.masterHandle || 'master_trader',
      masterWallet: dto.masterWallet,
      masterTxHash: dto.masterTxHash,
      vaultTxHash,
      jitoBundleId,
      slotNumber,
      symbol: dto.symbol || '$SOL',
      action: dto.action || 'BUY',
      amountUsd: dto.amountUsd || 15000,
      executionVenue: dto.venue || 'Phoenix CLOB',
      copyDelayMs: Math.round(68 + Math.random() * 25),
      slippageBps: 6,
      status: 'CONFIRMED',
      timestamp: new Date().toISOString(),
    };
  }

  async executePaper(dto: ExecuteCopyDto, overrides: PaperOverrides = {}): Promise<CopyOrderShape> {
    const cfg = getConfig();
    const enabled = overrides.paperEnabled ?? cfg.copyTradePaperEnabled;
    const maxUsd = overrides.maxUsd ?? cfg.copyTradeMaxUsd;
    if (!enabled) {
      fail('Paper trading is disabled. Set COPY_TRADE_PAPER_ENABLED=true locally to enable devnet paper.');
    }
    if (dto.confirm !== true) {
      fail('Explicit 1-click confirmation required (confirm:true).');
    }
    if (dto.amountUsd !== undefined && (!Number.isFinite(dto.amountUsd) || dto.amountUsd <= 0)) {
      fail('Source notional must be positive.');
    }
    // Solution v2 sizing: copy = min(master, 1% vault NAV, 0.1 SOL, maxUsd).
    // Auto-scales down; signals below one cent are refused. Skipped while the vault
    // has no settled epoch yet (bootstrap).
    let sizedCapUsd = maxUsd;
    let sizedNote: Record<string, unknown> = { mode: 'bootstrap' };
    let navUsd = 0;
    let solPrice = 0;
    const market = overrides.market ?? this.market;
    const sizingVaultId = overrides.vaultId ?? 1;
    try {
      const st = await this.vaults.status(sizingVaultId);
      const px = await market.bulkPrices([DEFAULT_SOL_MINT]);
      solPrice = px[DEFAULT_SOL_MINT] ?? 0;
      if (st.lastEpoch) {
        if (solPrice > 0) {
          navUsd = st.lastEpoch.navSol * solPrice;
          sizedCapUsd = Math.min(maxUsd, navUsd * 0.01, 0.1 * solPrice);
          sizedNote = {
            navSol: st.lastEpoch.navSol,
            navUsd: Math.round(navUsd * 100) / 100,
            capUsd: Math.round(sizedCapUsd * 100) / 100,
          };
        }
      }
    } catch {
      // Missing SOL prices are refused before quoting; no allocation is executed.
    }
    const masterUsd = dto.amountUsd ?? sizedCapUsd;
    // Dynamic allocation (G): slice the NAV budget by the trader's vault weight.
    // Fail-open to legacy full budget when weights are missing.
    let weightShare = 1;
    let weightNote: Record<string, unknown> = { mode: 'unweighted' };
    try {
      if (dto.masterWallet) {
        const traders = await this.prisma.vaultTrader.findMany({
          where: { vaultId: sizingVaultId, isActive: true },
        });
        if (traders.length > 0) {
          const hit = traders.find((t) => t.wallet === dto.masterWallet);
          if (hit) {
            const total = traders.reduce((s, t) => s + ((t.weightBps as number | null) ?? 0), 0);
            const share = total > 0 ? ((hit.weightBps as number | null) ?? 0) / total : 1 / traders.length;
            weightShare = share > 0 ? share : 1 / traders.length;
            weightNote = { mode: 'weighted', weightBps: hit.weightBps, traders: traders.length };
          } else {
            weightNote = { mode: 'out-of-scope-manual' };
          }
        }
      }
    } catch {
      // Weight lookup skipped on failure — legacy budget applies.
    }
    const traderCap = sizedCapUsd * weightShare;
    const copyUsd = Math.floor((Math.min(masterUsd, traderCap) + Number.EPSILON) * 100) / 100;
    if (!(copyUsd > 0)) fail('Copy allocation is below the minimum representable notional ($0.01).');
    // ATR regime auto-tune (R1): derive stop/TP/trail from 1h volatility unless
    // the caller pinned explicit values (explicit-wins) or opted out. Fail-open
    // to 60/30/20 defaults when candles are missing — paper still fires.
    let effTp1 = dto.tp1Pct ?? 60;
    let effStop = dto.stopPct ?? 30;
    let effTrail = dto.trailPct ?? null;
    let tuneNote: Record<string, unknown> = { mode: 'fixed-defaults' };
    if ((dto.autoTune ?? true) && dto.tokenMint && (dto.tp1Pct === undefined || dto.stopPct === undefined)) {
      try {
        const candles = await market.candles(dto.tokenMint, { interval: '60', count: 30 });
        const regime = DataStreamService.suggestRegime(candles);
        if (regime) {
          if (dto.tp1Pct === undefined) effTp1 = regime.tp1Pct;
          if (dto.stopPct === undefined) effStop = regime.stopPct;
          if (dto.trailPct === undefined) effTrail = regime.trailPct;
          tuneNote = { mode: 'atr-regime', ...regime };
        } else {
          tuneNote = { mode: 'fallback-no-candles' };
        }
      } catch {
        tuneNote = { mode: 'fallback-feed-error' };
      }
    } else if (dto.tp1Pct !== undefined || dto.stopPct !== undefined) {
      tuneNote = { mode: 'explicit-params' };
    }
    // Solution v2 (A1): entry is immediate by default; scaled|patient are
    // reserved for the Manage engine (B2) — v1 fires immediate either way.
    const entryMode = dto.entryMode ?? 'immediate';
    // Drag guard: skip entries that already ran up >25% (when measured).
    if (dto.delayDragPct !== undefined && dto.delayDragPct > 25) {
      fail(`Entry skipped: price already ran +${dto.delayDragPct}% since the master fill (cap 25%).`);
    }
    // Exposure caps (24h, non-FAILED): per-trader ≤3, per-mint ≤2.
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const liveWhere = { status: { not: 'FAILED' }, createdAt: { gte: dayAgo } };
    const [traderCount, mintCount] = await Promise.all([
      dto.masterWallet
        ? this.prisma.copyOrder.count({ where: { ...liveWhere, masterWallet: dto.masterWallet } })
        : Promise.resolve(0),
      dto.symbol
        ? this.prisma.copyOrder.count({ where: { ...liveWhere, symbol: dto.symbol } })
        : Promise.resolve(0),
    ]);
    if (traderCount >= 3) {
      fail(`Exposure cap: trader ${dto.masterWallet} already has ${traderCount} live paper orders in 24h (max 3).`);
    }
    if (mintCount >= 2) {
      fail(`Exposure cap: ${dto.symbol} already has ${mintCount} live paper orders in 24h (max 2).`);
    }
    // Deck §3: max 10 open positions per vault (total risk ≤10% NAV).
    const openCount = await this.prisma.copyOrder.count({
      where: { vaultId: sizingVaultId, status: 'CONFIRMED', closedAt: null },
    });
    if (openCount >= 10) {
      fail(`Pool already holds ${openCount} open positions (max 10).`);
    }
    // Deck §7.4 layer 2: per-mint ≤2% NAV by value (open CONFIRMED notional).
    if (navUsd > 0 && dto.tokenMint) {
      const mintOpen = await this.prisma.copyOrder.findMany({
        where: { vaultId: sizingVaultId, tokenMint: dto.tokenMint, status: 'CONFIRMED', closedAt: null },
        select: { amountUsd: true, legs: { select: { fraction: true } } },
      });
      const mintUsd = mintOpen.reduce((sum, order) => sum + remainingNotionalUsd(order), 0);
      if (mintUsd + copyUsd > navUsd * 0.02 + 1e-9) {
        fail(`Per-mint cap: ${(dto.symbol ?? dto.tokenMint).slice(0, 12)} open $${Math.round(mintUsd)} + $${copyUsd} entrant exceeds 2% NAV ($${Math.round(navUsd * 0.02)}).`);
      }
    }
    // Kill-switch gate: halted vaults refuse NEW risk on every entry path
    // (auto-fire, demo replay, manual execute). Settle/withdraw unaffected.
    {
      const [vv, veps] = await Promise.all([
        this.prisma.vault.findMany({ where: { id: { in: [sizingVaultId] } } }),
        this.prisma.epochCheckpoint.findMany({ where: { vaultId: { in: [sizingVaultId] } }, orderBy: { id: 'asc' } }),
      ]);
      const vrow = (vv as { status?: unknown; rulesJson?: unknown }[])[0];
      const halt = isHaltedVault(
        vrow?.status,
        vrow?.rulesJson,
        veps as unknown as { navSol: unknown; createdAt: unknown }[],
      );
      if (halt.halted) {
        fail(`Kill-switch: vault ${sizingVaultId} halted (day ${halt.dayPct}% / week ${halt.weekPct}%). New entries blocked.`);
      }
    }
    const executor = overrides.executor ?? this.paper;
    const rugs = overrides.rugcheck ?? this.rugs;
    const strict = overrides.strict ?? process.env.RUGCHECK_STRICT !== 'false';
    const minMcap = Number(process.env.COPY_MIN_MCAP_USD ?? 50000);
    const order = await this.prisma.copyOrder.create({
      data: {
        masterWallet: dto.masterWallet,
        masterHandle: dto.masterHandle,
        masterTxHash: dto.masterTxHash,
        vaultId: sizingVaultId,
        symbol: dto.symbol,
        action: dto.action,
        tokenMint: dto.tokenMint,
        amountUsd: copyUsd,
        venue: dto.venue,
        mode: 'paper',
        status: 'PENDING',
        entryMode,
        delayDragPct: dto.delayDragPct,
        tp1Pct: effTp1,
        stopPct: effStop,
        tp1ShareBps: dto.tp1ShareBps ?? null,
        trailPct: effTrail,
        tp2MultPct: dto.tp2MultPct ?? null,
      },
    });
    try {
      const connection = overrides.connection ?? new Connection(cfg.devnetRpcUrl, 'confirmed');
      await executor.assertDevnet(connection);
      // Solution v2 Qualify: RugCheck gate when mint is known. Strict blocks;
      // lenient records the verdict and proceeds. Fail-open on API errors in
      // lenient mode (verdict saved, execution continues).
      let rugNote: Record<string, unknown> | undefined;
      let liqNote: Record<string, unknown> | undefined;
      if (dto.tokenMint) {
        try {
          const q = await rugs.qualify(dto.tokenMint);
          rugNote = { mint: dto.tokenMint, pass: q.pass, reasons: q.reasons, score: q.verdict.score };
          if (strict && !q.pass) {
            await this.prisma.copyOrder.update({
              where: { id: order.id },
              data: { status: 'FAILED', error: `Qualify blocked: ${q.reasons.join('; ').slice(0, 300)}` },
            });
            fail(`Qualify blocked: ${q.reasons.join('; ').slice(0, 300)}`, { orderId: order.id });
          }
          // Liquidity gate: market cap floor (deck "liquidity cap" leg).
          const det = await market.tokenDetails(dto.tokenMint);
          if (det?.marketCap !== undefined) {
            liqNote = { marketCap: det.marketCap, minMcap };
            if (strict && det.marketCap < minMcap) {
              await this.prisma.copyOrder.update({
                where: { id: order.id },
                data: { status: 'FAILED', error: `Qualify blocked: mcap $${det.marketCap} < $${minMcap}` },
              });
              fail(`Qualify blocked: mcap $${det.marketCap} below $${minMcap} floor.`, { orderId: order.id });
            }
          }
        } catch (e) {
          const msg = (e as Error).message.slice(0, 300);
          if (strict) {
            await this.prisma.copyOrder.update({
              where: { id: order.id },
              data: { status: 'FAILED', error: `Qualify error: ${msg}` },
            });
            fail(`Qualify error: ${msg}`, { orderId: order.id });
          }
          rugNote = { mint: dto.tokenMint, pass: true, apiError: (e as Error).message.slice(0, 200) };
        }
      }
      if (!Number.isFinite(solPrice) || solPrice <= 0) fail('SOL price unavailable for copy quote.');
      const quoteLamports = Math.floor((copyUsd / solPrice) * 1e9);
      if (quoteLamports <= 0) fail('Copy allocation is below one lamport.');
      const quote = await executor.fetchQuote({
        inputMint: DEFAULT_SOL_MINT,
        outputMint: dto.tokenMint ?? DEFAULT_USDC_MINT,
        amount: String(quoteLamports),
        slippageBps: dto.maxSlippageBps ?? 50,
      });
      await this.prisma.copyOrder.update({
        where: { id: order.id },
        data: {
          status: 'QUATED',
          quoteJson: {
            ...quote,
            ...(rugNote ? { qualify: rugNote } : {}),
            ...(liqNote ? { liquidity: liqNote } : {}),
            sized: {
              masterUsd,
              copyUsd,
              ...sizedNote,
              tune: tuneNote,
              alloc: { ...weightNote, traderCapUsd: Math.round(traderCap * 100) / 100 },
              ...(overrides.triggeredBy ? { triggeredBy: overrides.triggeredBy } : {}),
            },
          } as unknown as object,
        },
      });
      // Slippage gate: quote impact over the limit blocks (deck leg).
      const impactBps = Number(quote.priceImpactPct ?? 0) * 100;
      const slipLimit = dto.maxSlippageBps ?? 50;
      if (impactBps > slipLimit) {
        await this.prisma.copyOrder.update({
          where: { id: order.id },
          data: { status: 'FAILED', error: `Slippage ${impactBps}bps over limit ${slipLimit}bps.` },
        });
        fail(`Slippage ${impactBps}bps over limit ${slipLimit}bps.`, { orderId: order.id });
      }
      const payer = executor.loadVaultKeypair();
      const proof = await executor.executeProof(connection, payer, dto.paperAmountSol ?? 0.0001);
      await this.prisma.copyOrder.update({
        where: { id: order.id },
        data: { status: 'SENT', devnetSignature: proof.signature },
      });
      const done = await this.prisma.copyOrder.update({
        where: { id: order.id },
        data: { status: 'CONFIRMED' },
      });
      return toOrderShape(done);
    } catch (e) {
      // Nest HttpExceptions already carry envelopes — persist message only,
      // then rethrow (BadRequest) or wrap (unexpected) with the order id.
      const body = (e as { getResponse?: () => unknown })?.getResponse?.() as
        | { message?: unknown }
        | undefined;
      const text =
        typeof body?.message === 'string'
          ? body.message
          : e instanceof Error
            ? e.message
            : 'Paper execution failed.';
      const short = text.slice(0, 500);
      await this.prisma.copyOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED', error: short },
      });
      if (e instanceof BadRequestException) throw e;
      fail(short, { orderId: order.id });
    }
  }

  async listHistory(wallet?: string, limit = 20): Promise<{ total: number; data: CopyOrderShape[] }> {
    const take = Math.min(Math.max(limit || 20, 1), 100);
    const where = wallet ? { masterWallet: wallet } : {};
    const [total, rows] = await Promise.all([
      this.prisma.copyOrder.count({ where }),
      this.prisma.copyOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take, include: { legs: true } }),
    ]);
    return { total, data: rows.map(toOrderShape) };
  }
}
