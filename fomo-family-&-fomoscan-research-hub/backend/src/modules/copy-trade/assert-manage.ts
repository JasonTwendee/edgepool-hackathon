/**
 * Executable evidence for TP ladder + trailing-stop (intent D-L1..D-L4).
 * Run: `npx tsx src/modules/copy-trade/assert-manage.ts` (mocked, no network).
 */
import assert from 'node:assert/strict';
import { ManageService, evaluateManage } from './manage.service.js';
import { AuditService } from '../audit/audit.service.js';

type Row = Record<string, unknown>;
const dec = (n: number): { toNumber: () => number } => ({ toNumber: () => n });

function makeWorld(cfg: {
  orders: Row[];
  legs: Row[];
  spot: Record<string, number>;
  candles?: Record<string, { timestamp: number; close: number }[]>;
  candleFail?: boolean;
}) {
  const audits: Row[] = [];
  const prisma = {
    copyOrder: {
      findMany: async () => cfg.orders.filter((o) => o.closedAt === null),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = cfg.orders.find((x) => x.id === where.id) as Row;
        Object.assign(r, data);
        return r;
      },
    },
    copyOrderLeg: {
      findMany: async ({ where }: { where: Row }) =>
        cfg.legs.filter((l) => l.orderId === (where as Row).orderId),
      create: async ({ data }: { data: Row }) => {
        const r = { id: cfg.legs.length + 1, closedAt: new Date(), ...data };
        cfg.legs.push(r);
        return r;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: audits.length + 1, createdAt: new Date(), ...data };
        audits.push(r);
        return r;
      },
      count: async () => audits.length,
      findMany: async () => [...audits],
    },
  } as never;
  const prices = {
    bulkPrices: async () => ({ ...cfg.spot }),
    candles: async (mint: string) => {
      if (cfg.candleFail) throw new Error('candles down');
      return cfg.candles?.[mint] ?? [];
    },
  } as never;
  const svc = new ManageService(prisma, prices, new AuditService(prisma));
  return { svc, audits, legs: cfg.legs, orders: cfg.orders };
}

const MINT = 'MINT11111111111111111111111111111111111111111';
const base = {
  symbol: '$T',
  action: 'BUY',
  tokenMint: MINT,
  amountUsd: dec(100),
  tp1Pct: dec(60),
  stopPct: dec(30),
  createdAt: new Date(),
  entryPriceUsd: dec(1),
  peakPriceUsd: null,
  closedAt: null,
  realizedPnlUsd: null,
  exitPriceUsd: null,
  closeReason: null,
};

async function main(): Promise<void> {
  // 1. Evaluate matrix (shared math with v1 script).
  assert.equal(evaluateManage(70, 60, 30), 'TP1_HIT');
  assert.equal(evaluateManage(-35, 60, 30), 'STOP_HIT');
  assert.equal(evaluateManage(10, 60, 30), 'HOLD');
  assert.equal(evaluateManage(null, 60, 30), 'UNKNOWN');
  assert.equal(evaluateManage(NaN, 60, 30), 'UNKNOWN');

  // 2. STOP takes the whole remainder at market.
  {
    const w = makeWorld({ orders: [{ ...base, id: 1 }], legs: [], spot: { [MINT]: 0.6 } });
    const s = await w.svc.tick();
    assert.equal(s.stops, 1);
    assert.deepEqual(s.closedIds, [1]);
    assert.equal(w.legs.length, 1);
    assert.equal(w.legs[0].leg, 'STOP');
    assert.equal(w.legs[0].fraction, 1);
    assert.equal(w.legs[0].exitPriceUsd, 0.6);
    assert.equal(w.legs[0].realizedPnlUsd, -40);
    assert.equal(w.orders[0].closeReason, 'STOP_HIT');
    assert.ok(w.orders[0].closedAt instanceof Date);
    assert.equal(w.audits[0].target, 'order:1:STOP');
  }
  // 3. TP1 partial: half @ target, order stays open with running totals.
  {
    const w = makeWorld({ orders: [{ ...base, id: 2 }], legs: [], spot: { [MINT]: 1.7 } });
    const s = await w.svc.tick();
    assert.equal(s.tp1, 1);
    assert.deepEqual(s.closedIds, []);
    assert.equal(w.legs.length, 1);
    assert.equal(w.legs[0].leg, 'TP1');
    assert.equal(w.legs[0].fraction, 0.5);
    assert.equal(w.legs[0].exitPriceUsd, 1.6);
    assert.equal(w.legs[0].realizedPnlUsd, 30);
    assert.equal(w.orders[0].closedAt, null);
    assert.equal(w.orders[0].realizedPnlUsd, 30);
  }
  // 4. TP2 completes the ladder at 2×tp1 target.
  {
    const tp1 = { id: 1, orderId: 3, leg: 'TP1', fraction: 0.5, exitPriceUsd: 1.6, realizedPnlUsd: 30, closedAt: new Date() };
    const w = makeWorld({
      orders: [{ ...base, id: 3, realizedPnlUsd: 30, peakPriceUsd: dec(1.7) }],
      legs: [tp1],
      spot: { [MINT]: 2.3 },
    });
    const s = await w.svc.tick();
    assert.equal(s.tp2, 1);
    assert.deepEqual(s.closedIds, [3]);
    const tp2 = w.legs.find((l) => l.leg === 'TP2') as Row;
    assert.equal(tp2.fraction, 0.5);
    assert.equal(tp2.exitPriceUsd, 2.2);
    assert.equal(tp2.realizedPnlUsd, 60);
    assert.equal(w.orders[0].realizedPnlUsd, 90);
    assert.equal(w.orders[0].closeReason, 'TP1_HIT');
  }
  // 5. TRAIL closes remainder on 20% pullback from peak (post-TP1).
  {
    const tp1 = { id: 1, orderId: 4, leg: 'TP1', fraction: 0.5, exitPriceUsd: 1.6, realizedPnlUsd: 30, closedAt: new Date() };
    const w = makeWorld({
      orders: [{ ...base, id: 4, realizedPnlUsd: 30, peakPriceUsd: dec(2) }],
      legs: [tp1],
      spot: { [MINT]: 1.7 },
    });
    const s = await w.svc.tick();
    assert.equal(s.trails, 1);
    const trail = w.legs.find((l) => l.leg === 'TRAIL') as Row;
    assert.equal(trail.fraction, 0.5);
    assert.equal(trail.exitPriceUsd, 1.7);
    assert.equal(trail.realizedPnlUsd, 35);
    assert.equal(w.orders[0].closeReason, 'TRAIL_HIT');
  }
  // 6. No trail yet above the pullback line → HOLD, peak tracked.
  {
    const tp1 = { id: 1, orderId: 5, leg: 'TP1', fraction: 0.5, exitPriceUsd: 1.6, realizedPnlUsd: 30, closedAt: new Date() };
    const w = makeWorld({
      orders: [{ ...base, id: 5, realizedPnlUsd: 30, peakPriceUsd: dec(2) }],
      legs: [tp1],
      spot: { [MINT]: 1.9 },
    });
    const s = await w.svc.tick();
    assert.equal(s.holds, 1);
    assert.equal(w.legs.length, 1);
  }
  // 7. TIME_STOP closes stale remainder at market.
  {
    const w = makeWorld({
      orders: [{ ...base, id: 6, createdAt: new Date(Date.now() - 25 * 3600 * 1000) }],
      legs: [],
      spot: { [MINT]: 1.05 },
    });
    const s = await w.svc.tick();
    assert.equal(s.timeStops, 1);
    assert.equal(w.legs[0].leg, 'TIME');
    assert.equal(w.audits[0].actor, 'manage:auto_close');
  }
  // 7b. Partial TIME leg + stale unpriceable remainder (order-118 shape):
  // no duplicate TIME row — the order is stamped closed on existing legs.
  {
    const time = { id: 1, orderId: 9, leg: 'TIME', fraction: 0.4, exitPriceUsd: 0.005, realizedPnlUsd: 0, closedAt: new Date() };
    const w = makeWorld({
      orders: [{ ...base, id: 9, createdAt: new Date(Date.now() - 25 * 3600 * 1000) }],
      legs: [time],
      spot: {},
    });
    const s = await w.svc.tick();
    assert.equal(s.timeStops, 1);
    assert.deepEqual(s.closedIds, [9]);
    assert.equal(w.legs.length, 1);
    assert.equal(w.orders[0].closeReason, 'TIME_STOP');
    assert.ok(w.orders[0].closedAt instanceof Date);
    assert.equal(w.audits[0].target, 'order:9:TIME-remainder');
  }
  // 8. SELL mirror: short profits on falling price, TP1 partial @ target below entry.
  {
    const w = makeWorld({
      orders: [{ ...base, id: 7, action: 'SELL' }],
      legs: [],
      spot: { [MINT]: 0.3 },
    });
    const s = await w.svc.tick();
    assert.equal(s.tp1, 1);
    const tp1 = w.legs.find((l) => l.leg === 'TP1') as Row;
    assert.equal(tp1.exitPriceUsd, 0.4);
    assert.equal(tp1.realizedPnlUsd, 30);
  }
  // 9. Idempotency: closed rows never resurface.
  {
    const w = makeWorld({ orders: [{ ...base, id: 8 }], legs: [], spot: { [MINT]: 2.5 } });
    await w.svc.tick(); // TP1 partial (remaining 0.5)
    const s2 = await w.svc.tick(); // TP2 completes (move 150 ≥ 120)
    assert.equal(s2.tp2, 1);
    const s3 = await w.svc.tick();
    assert.equal(s3.scanned, 0);
    assert.equal(s3.note, 'no-open-positions');
  }
  // 10. Loop kill-switch.
  {
    const w = makeWorld({ orders: [], legs: [], spot: {} });
    const prev = process.env.COPY_MANAGE_INTERVAL_MS;
    process.env.COPY_MANAGE_INTERVAL_MS = '0';
    w.svc.onModuleInit();
    assert.equal((w.svc as unknown as Row).timer, undefined);
    if (prev === undefined) delete process.env.COPY_MANAGE_INTERVAL_MS;
    else process.env.COPY_MANAGE_INTERVAL_MS = prev;
  }
  // 11. Per-order config: TP1 25% share.
  {
    const w = makeWorld({
      orders: [{ ...base, id: 9, tp1ShareBps: 2500, trailPct: null, tp2MultPct: null }],
      legs: [],
      spot: { [MINT]: 1.7 },
    });
    const s = await w.svc.tick();
    assert.equal(s.tp1, 1);
    assert.equal(w.legs[0].fraction, 0.25);
    assert.equal(w.legs[0].realizedPnlUsd, 15);
  }
  // 12. Per-order config: trail 10% pullback closes (default 20% would HOLD).
  {
    const tp1 = { id: 1, orderId: 10, leg: 'TP1', fraction: 0.5, exitPriceUsd: 1.6, realizedPnlUsd: 30, closedAt: new Date() };
    const w = makeWorld({
      orders: [{ ...base, id: 10, realizedPnlUsd: 30, peakPriceUsd: dec(2), tp1ShareBps: null, trailPct: 10, tp2MultPct: null }],
      legs: [tp1],
      spot: { [MINT]: 1.85 },
    });
    const s = await w.svc.tick();
    assert.equal(s.trails, 1);
    assert.equal(s.holds, 0);
  }
  // 13. Per-order config: TP2 at 150% of tp1 (move +95 hits 90 target, default 120% would HOLD).
  {
    const tp1 = { id: 1, orderId: 11, leg: 'TP1', fraction: 0.5, exitPriceUsd: 1.6, realizedPnlUsd: 30, closedAt: new Date() };
    const w = makeWorld({
      orders: [{ ...base, id: 11, realizedPnlUsd: 30, peakPriceUsd: dec(1.95), tp1ShareBps: null, trailPct: null, tp2MultPct: 150 }],
      legs: [tp1],
      spot: { [MINT]: 1.95 },
    });
    const s = await w.svc.tick();
    assert.equal(s.tp2, 1);
    const tp2 = w.legs.find((l) => l.leg === 'TP2') as Row;
    assert.equal(tp2.exitPriceUsd, 1.9);
    assert.equal(tp2.realizedPnlUsd, 45);
  }

  console.log('manage asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
