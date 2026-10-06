import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { AuditService } from '../audit/audit.service.js';
import { emitSignal } from './signal-bus.js';

export type ManageAction = 'HOLD' | 'TP1_HIT' | 'TP2_HIT' | 'STOP_HIT' | 'TRAIL_HIT' | 'TIME_STOP' | 'UNKNOWN';

export interface ManageTickSummary {
  scanned: number;
  holds: number;
  tp1: number;
  tp2: number;
  stops: number;
  trails: number;
  timeStops: number;
  unknown: number;
  errors: number;
  closedIds: number[];
  note?: string;
}

/** Time-stop: positions open longer than this are closed at market. */
export const MANAGE_TIME_STOP_MS = 24 * 3600 * 1000;

/** Ladder constants (intent D-L4): TP1 takes half at +tp1; trailing activates
 * after TP1 and closes the remainder on a TRAIL_PCT pullback from peak;
 * TP2 takes the remainder at 2×tp1. TP fills at target (backtest convention),
 * stop/time/trail fill at market. */
export const LADDER_TP1_SHARE = 0.5;
export const LADDER_TRAIL_PCT = 20;
export const LADDER_TP2_MULT = 2;

type LegName = 'TP1' | 'TP2' | 'STOP' | 'TRAIL' | 'TIME';

/**
 * Promoted from manage-paper.ts v1 (same evaluate/move/peak/close math).
 * TP1_HIT when move >= tp1 (default 60); STOP_HIT when move <= -stop (default 30).
 */
export function evaluateManage(movePct: number | null, tp1: number, stop: number): ManageAction {
  if (movePct === null || !Number.isFinite(movePct)) return 'UNKNOWN';
  if (movePct <= -Math.abs(stop)) return 'STOP_HIT';
  if (movePct >= Math.abs(tp1)) return 'TP1_HIT';
  return 'HOLD';
}

const num = (v: { toNumber(): number } | number | null | undefined): number | null => {
  if (typeof v === 'number') return v;
  return v?.toNumber() ?? null;
};

/**
 * B2 manage engine (paper-only bookkeeping): backfills entries, tracks peaks,
 * auto-closes TP1/STOP/TIME_STOP with realized PnL + audit. Idempotent —
 * only scans `closedAt == null`.
 */
@Injectable()
export class ManageService implements OnModuleInit {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DataStreamService) private readonly prices: DataStreamService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const ms = Number(process.env.COPY_MANAGE_INTERVAL_MS ?? 300000);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e: unknown) => {
        console.warn('[manage] loop tick failed:', (e as Error).message);
      });
    }, ms);
    this.timer.unref?.();
  }

  async tick(limit = 50): Promise<ManageTickSummary> {
    if (this.running) {
      return { scanned: 0, holds: 0, tp1: 0, tp2: 0, stops: 0, trails: 0, timeStops: 0, unknown: 0, errors: 0, closedIds: [], note: 'concurrent-tick-skipped' };
    }
    this.running = true;
    try {
      const summary: ManageTickSummary = {
        scanned: 0, holds: 0, tp1: 0, tp2: 0, stops: 0, trails: 0, timeStops: 0, unknown: 0, errors: 0, closedIds: [],
      };
      const orders = await this.prisma.copyOrder.findMany({
        where: { status: 'CONFIRMED', mode: 'paper', closedAt: null, NOT: [{ tokenMint: null }] },
        select: {
          id: true, symbol: true, action: true, tokenMint: true, amountUsd: true,
          tp1Pct: true, stopPct: true, createdAt: true, entryPriceUsd: true, peakPriceUsd: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
      });
      summary.scanned = orders.length;
      if (orders.length === 0) return { ...summary, note: 'no-open-positions' };
      const mints = [...new Set(orders.map((o) => o.tokenMint as string))];
      const spot = await this.prices.bulkPrices(mints).catch(() => ({}) as Record<string, number>);
      for (const o of orders) {
        try {
          const res = await this.evaluateOne(o as never, spot);
          if (res.action === 'HOLD') summary.holds++;
          else if (res.action === 'TP1_HIT') summary.tp1++;
          else if (res.action === 'TP2_HIT') summary.tp2++;
          else if (res.action === 'STOP_HIT') summary.stops++;
          else if (res.action === 'TRAIL_HIT') summary.trails++;
          else if (res.action === 'TIME_STOP') summary.timeStops++;
          else summary.unknown++;
          if (res.closed) summary.closedIds.push(o.id);
        } catch (e) {
          summary.errors++;
          console.warn(`[manage] order ${o.id} failed:`, (e as Error).message);
        }
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async evaluateOne(
    o: {
      id: number; symbol: string | null; action: string | null; tokenMint: string;
      amountUsd: { toNumber(): number } | number | null;
      tp1Pct: { toNumber(): number } | number | null;
      stopPct: { toNumber(): number } | number | null;
      tp1ShareBps: number | null; trailPct: number | null; tp2MultPct: number | null;
      createdAt: Date; entryPriceUsd: { toNumber(): number } | number | null;
      peakPriceUsd: { toNumber(): number } | number | null;
    },
    spot: Record<string, number>,
  ): Promise<{ action: ManageAction; closed: boolean }> {
    const mint = o.tokenMint;
    const t0 = Math.floor(o.createdAt.getTime() / 1000);
    let entry = num(o.entryPriceUsd);
    if (entry === null) {
      try {
        const candles = await this.prices.candles(mint, { interval: '1', from: t0 - 120, count: 60 });
        entry = candles.find((c) => c.timestamp >= t0)?.close ?? null;
      } catch {
        entry = null;
      }
      if (entry !== null) {
        await this.prisma.copyOrder.update({ where: { id: o.id }, data: { entryPriceUsd: entry } });
      }
    }
    const dir = o.action === 'SELL' ? -1 : 1;
    const now = spot[mint] ?? null;
    const tp1 = num(o.tp1Pct) ?? 60;
    const stop = num(o.stopPct) ?? 30;
    const notional = num(o.amountUsd) ?? 0;
    // Per-order ladder config (null = engine defaults).
    const tp1Share = (o.tp1ShareBps ?? LADDER_TP1_SHARE * 10000) / 10000;
    const trailPct = o.trailPct ?? LADDER_TRAIL_PCT;
    const tp2Mult = (o.tp2MultPct ?? LADDER_TP2_MULT * 100) / 100;
    const stale = Date.now() - o.createdAt.getTime() > MANAGE_TIME_STOP_MS;
    const legs = await this.prisma.copyOrderLeg.findMany({ where: { orderId: o.id } });
    const has = (leg: LegName): boolean => legs.some((l) => l.leg === leg);
    let remaining = Math.max(0, 1 - legs.reduce((s, l) => s + Number(l.fraction), 0));
    if (remaining <= 1e-9) {
      await this.finishIfOpen(o.id);
      return { action: 'HOLD', closed: true };
    }
    // TIME_STOP with no price: scratch at entry (no market to mark).
    if (stale && (entry === null || now === null)) {
      await this.fillLeg(o.id, 'TIME', remaining, entry ?? 0, 0);
      return { action: 'TIME_STOP', closed: true };
    }
    const move = entry !== null && now !== null && entry > 0 ? (((now - entry) / entry) * 100 * dir) : null;
    if (move === null || entry === null || now === null) return { action: 'UNKNOWN', closed: false };
    // Peak tracking (always, when priced).
    const cur = entry * (1 + (move * dir) / 100);
    const peakPrev = num(o.peakPriceUsd) ?? entry;
    const peak = dir > 0 ? Math.max(peakPrev, cur) : Math.min(peakPrev, cur);
    await this.prisma.copyOrder.update({ where: { id: o.id }, data: { peakPriceUsd: peak } });
    const peakMove = ((peak - entry) / entry) * 100 * dir;
    const r2 = (v: number): number => Math.round(v * 100) / 100;

    // STOP takes the whole remainder at market.
    if (move <= -Math.abs(stop)) {
      await this.fillLeg(o.id, 'STOP', remaining, cur, r2((move / 100) * notional * remaining));
      return { action: 'STOP_HIT', closed: true };
    }
    // TP1 takes its configured share at target (backtest convention).
    if (!has('TP1') && move >= Math.abs(tp1)) {
      const share = Math.min(tp1Share, remaining);
      const target = entry * (1 + (Math.abs(tp1) / 100) * dir);
      await this.fillLeg(o.id, 'TP1', share, target, r2((Math.abs(tp1) / 100) * notional * share));
      remaining = Math.max(0, remaining - share);
      if (remaining <= 1e-9) return { action: 'TP1_HIT', closed: true };
      return { action: 'TP1_HIT', closed: false };
    }
    // TP2 takes the remainder at tp2Mult×tp1 target.
    if (has('TP1') && !has('TP2') && move >= Math.abs(tp1) * tp2Mult) {
      const target2 = entry * (1 + ((Math.abs(tp1) * tp2Mult) / 100) * dir);
      await this.fillLeg(
        o.id, 'TP2', remaining, target2,
        r2(((Math.abs(tp1) * tp2Mult) / 100) * notional * remaining),
      );
      return { action: 'TP2_HIT', closed: true };
    }
    // Trailing activates after TP1: remainder on peakMove pullback.
    if (has('TP1') && move <= peakMove - trailPct) {
      await this.fillLeg(o.id, 'TRAIL', remaining, cur, r2((move / 100) * notional * remaining));
      return { action: 'TRAIL_HIT', closed: true };
    }
    // TIME_STOP takes the remainder at market.
    if (stale) {
      await this.fillLeg(o.id, 'TIME', remaining, cur, r2((move / 100) * notional * remaining));
      return { action: 'TIME_STOP', closed: true };
    }
    return { action: 'HOLD', closed: false };
  }

  /** Close one leg: persist leg row + running order totals + audit. Full close
   * (remaining hits 0) also stamps closedAt/closeReason on the order. */
  private async fillLeg(
    orderId: number,
    leg: LegName,
    fraction: number,
    exitPrice: number,
    realized: number,
  ): Promise<void> {
    await this.prisma.copyOrderLeg.create({
      data: { orderId, leg, fraction, exitPriceUsd: exitPrice, realizedPnlUsd: realized, closedAt: new Date() },
    });
    const legs = await this.prisma.copyOrderLeg.findMany({ where: { orderId } });
    const done = legs.reduce((s, l) => s + Number(l.fraction), 0);
    const totalRealized = Math.round(legs.reduce((s, l) => s + Number(l.realizedPnlUsd ?? 0), 0) * 100) / 100;
    const lastExit = Number(legs[legs.length - 1]?.exitPriceUsd ?? exitPrice);
    if (1 - done <= 1e-9) {
      await this.prisma.copyOrder.update({
        where: { id: orderId },
        data: { exitPriceUsd: lastExit, closeReason: leg === 'TP1' || leg === 'TP2' ? 'TP1_HIT' : leg === 'TRAIL' ? 'TRAIL_HIT' : leg === 'STOP' ? 'STOP_HIT' : 'TIME_STOP', closedAt: new Date(), realizedPnlUsd: totalRealized },
      });
    } else {
      await this.prisma.copyOrder.update({
        where: { id: orderId },
        data: { exitPriceUsd: lastExit, realizedPnlUsd: totalRealized },
      });
    }
    await this.audit
      .record({
        actor: 'manage:auto_close',
        action: 'copy.manage_close',
        target: `order:${orderId}:${leg}`,
        reason: `${leg} frac=${fraction} exit=${exitPrice} realized=$${realized}`,
      })
      .catch((e: unknown) => {
        console.warn('[manage] audit record failed:', (e as Error).message);
      });
    // Terminal stream: one line per filled leg (best-effort, never breaks the tick).
    try {
      const ctx = (await this.prisma.copyOrder.findUnique({
        where: { id: orderId },
        select: { vaultId: true, symbol: true, tokenMint: true, masterHandle: true, masterWallet: true },
      })) as { vaultId: number | null; symbol: string | null; tokenMint: string | null; masterHandle: string | null; masterWallet: string | null } | null;
      if (ctx?.vaultId) {
        emitSignal({
          vaultId: ctx.vaultId,
          kind: 'EXIT',
          token: ctx.symbol ?? (ctx.tokenMint ?? '').slice(0, 8),
          trader: ctx.masterHandle ?? (ctx.masterWallet ?? '').slice(0, 8),
          note: `${leg} ${(fraction * 100).toFixed(0)}% @${exitPrice} (${realized >= 0 ? '+' : ''}$${realized})`,
        });
      }
    } catch {
      // stream-only; persist already succeeded above
    }
  }

  /** Safety: legs sum to 100% but the order row was never stamped closed. */
  private async finishIfOpen(orderId: number): Promise<void> {
    const legs = await this.prisma.copyOrderLeg.findMany({ where: { orderId } });
    const totalRealized = Math.round(legs.reduce((s, l) => s + Number(l.realizedPnlUsd ?? 0), 0) * 100) / 100;
    await this.prisma.copyOrder.update({
      where: { id: orderId },
      data: { closedAt: new Date(), realizedPnlUsd: totalRealized },
    });
  }
}
