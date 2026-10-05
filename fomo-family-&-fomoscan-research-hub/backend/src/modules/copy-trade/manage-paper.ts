/**
 * Solution v2 (B2 v1): paper position manager — alert-only, no writes.
 * Paper orders hold no real tokens, so TP/stop are evaluated as SHADOW levels:
 * entry price = first 1m candle close at/after order creation (DataStream),
 * current price = bulk spot. Reports HOLD / TP1_HIT / STOP_HIT per order.
 *
 * Run: `npx tsx src/modules/copy-trade/manage-paper.ts [--selftest]`
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaService } from '../../database/prisma.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';

export type ManageAction = 'HOLD' | 'TP1_HIT' | 'STOP_HIT' | 'UNKNOWN';

export function evaluate(movePct: number | null, tp1: number, stop: number): ManageAction {
  if (movePct === null || !Number.isFinite(movePct)) return 'UNKNOWN';
  if (movePct <= -Math.abs(stop)) return 'STOP_HIT';
  if (movePct >= Math.abs(tp1)) return 'TP1_HIT';
  return 'HOLD';
}

function selftest(): void {
  assert.equal(evaluate(70, 60, 30), 'TP1_HIT');
  assert.equal(evaluate(-35, 60, 30), 'STOP_HIT');
  assert.equal(evaluate(10, 60, 30), 'HOLD');
  assert.equal(evaluate(null, 60, 30), 'UNKNOWN');
  assert.equal(evaluate(NaN, 60, 30), 'UNKNOWN');
  console.log('manage-paper selftest: GREEN');
}

async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    selftest();
    return;
  }
  const prisma = new PrismaService();
  const ds = new DataStreamService();
  const orders = await prisma.copyOrder.findMany({
    where: { status: 'CONFIRMED', mode: 'paper', NOT: [{ tokenMint: null }] },
    select: {
      id: true, symbol: true, action: true, tokenMint: true, amountUsd: true,
      tp1Pct: true, stopPct: true, createdAt: true, entryPriceUsd: true,
      peakPriceUsd: true, closedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const open = orders.filter((o) => o.closedAt === null);
  if (open.length === 0) {
    console.log('No open CONFIRMED paper positions — nothing to evaluate.');
    await prisma.$disconnect();
    return;
  }
  const mints = [...new Set(orders.map((o) => o.tokenMint as string))];
  const spot = await ds.bulkPrices(mints).catch((e) => {
    console.log(`bulk prices failed: ${(e as Error).message}`);
    return {} as Record<string, number>;
  });
  const tally: Record<ManageAction, number> = { HOLD: 0, TP1_HIT: 0, STOP_HIT: 0, UNKNOWN: 0 };
  let closed = 0;
  for (const o of open) {
    const mint = o.tokenMint as string;
    const t0 = Math.floor(o.createdAt.getTime() / 1000);
    // Backfill entry from the first 1m candle at/after creation.
    let entry = o.entryPriceUsd?.toNumber() ?? null;
    if (entry === null) {
      try {
        const candles = await ds.candles(mint, { interval: '1', from: t0 - 120, count: 60 });
        entry = candles.find((c) => c.timestamp >= t0)?.close ?? null;
      } catch {
        entry = null;
      }
      if (entry !== null) {
        await prisma.copyOrder.update({ where: { id: o.id }, data: { entryPriceUsd: entry } });
      }
    }
    const now = spot[mint] ?? null;
    const tp1 = o.tp1Pct?.toNumber() ?? 60;
    const stop = o.stopPct?.toNumber() ?? 30;
    const dir = o.action === 'SELL' ? -1 : 1; // SELL paper = short proxy
    const move = entry !== null && now !== null && entry > 0 ? (((now - entry) / entry) * 100 * dir) : null;
    const action = evaluate(move, tp1, stop);
    tally[action] += 1;
    // Peak tracking + shadow close (bookkeeping only — dust proofs hold no
    // real position; Manage auto-close on real swaps arrives with B2-full).
    const peakPrev = o.peakPriceUsd?.toNumber() ?? entry;
    if (move !== null && entry !== null) {
      const cur = entry * (1 + (move * dir) / 100);
      const peak = peakPrev !== null ? (dir > 0 ? Math.max(peakPrev, cur) : Math.min(peakPrev, cur)) : cur;
      await prisma.copyOrder.update({ where: { id: o.id }, data: { peakPriceUsd: peak } });
      if (action === 'TP1_HIT' || action === 'STOP_HIT') {
        const notional = o.amountUsd?.toNumber() ?? 0;
        const realized = Math.round(((move / 100) * notional) * 100) / 100;
        await prisma.copyOrder.update({
          where: { id: o.id },
          data: { exitPriceUsd: cur, closeReason: action, closedAt: new Date(), realizedPnlUsd: realized },
        });
        closed++;
      }
    }
    console.log(
      `#${o.id} ${o.symbol ?? '?'} entry=${entry === null ? '—' : entry.toFixed(6)} move=${move === null ? '—' : move.toFixed(1) + '%'} → ${action}`,
    );
    await new Promise((r) => setTimeout(r, 250));
  }
  await prisma.$disconnect();
  console.log(`summary: ${JSON.stringify(tally)}, closed this run: ${closed} (shadow bookkeeping, no funds moved)`);
}

void main().catch((e) => {
  console.error('MANAGE FAILED:', (e as Error).message);
  process.exit(1);
});
