/**
 * Executable evidence for Demo Simulator (seed/replay/reset/performance).
 * Run: `npx tsx src/modules/demo/assert-demo.ts` (mocked, no network).
 */
import assert from 'node:assert/strict';
import { DemoService } from './demo.service.js';

type Row = Record<string, unknown>;

function match(r: Row, w: Row): boolean {
  return Object.entries(w).every(([k, v]) => {
    if (v !== null && typeof v === 'object') {
      const o = v as Row;
      if ('startsWith' in o) return String(r[k]).startsWith(String(o.startsWith));
      if ('in' in o) return (o.in as unknown[]).includes(r[k]);
      if ('gte' in o || 'not' in o) return true;
      if ('path' in o) {
        const path = o.path as string[];
        let cur: unknown = r[k];
        for (const p of path) cur = (cur as Row)?.[p];
        if ('string_contains' in o) return String(cur ?? '').includes(String(o.string_contains));
        return cur === o.equals;
      }
      return true;
    }
    return r[k] === v;
  });
}

function makeWorld(seed: {
  wallets?: Row[];
  signals?: Row[];
  vaults?: Row[];
  bots?: Row[];
  orders?: Row[];
  legs?: Row[];
}) {
  const db = {
    wallets: seed.wallets ?? [],
    signals: seed.signals ?? [],
    vaults: seed.vaults ?? [],
    bots: seed.bots ?? [],
    orders: seed.orders ?? [],
    legs: seed.legs ?? [],
    deposits: [] as Row[],
    withdrawals: [] as Row[],
  };
  let seq = 100;
  const nid = (): number => {
    seq += 1;
    return seq;
  };
  const audits: Row[] = [];
  const fired: Row[] = [];
  const prisma = {
    trackedWallet: { findMany: async () => [...db.wallets] },
    transaction: { findMany: async () => [...db.signals] },
    vault: {
      findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row }) => {
        const rows = db.vaults.filter((r) => (!where || match(r, where)));
        if (orderBy && 'id' in orderBy) rows.sort((a, b) => (a.id as number) - (b.id as number));
        return rows[rows.length - 1] ?? null;
      },
      findMany: async ({ where }: { where?: Row }) => (!where ? [...db.vaults] : db.vaults.filter((r) => match(r, where))),
      findUnique: async ({ where }: { where: Row }) => db.vaults.find((r) => match(r, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), ...data, createdAt: new Date() };
        db.vaults.push(r);
        return r;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.vaults.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = db.vaults.length;
        db.vaults = db.vaults.filter((r) => !match(r, where));
        return { count: before - db.vaults.length };
      },
    },
    vaultTrader: {
      findMany: async () => [],
      create: async ({ data }: { data: Row }) => ({ id: nid(), ...data }),
      deleteMany: async ({ where }: { where: Row }) => {
        void where;
        return { count: 0 };
      },
    },
    deposit: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), status: 'QUEUED', ...data };
        db.deposits.push(r);
        return r;
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = db.deposits.length;
        db.deposits = db.deposits.filter((r) => !match(r, where));
        return { count: before - db.deposits.length };
      },
    },
    withdrawal: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), status: 'QUEUED', ...data };
        return r;
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = db.withdrawals.length;
        db.withdrawals = db.withdrawals.filter((r) => !match(r, where));
        return { count: before - db.withdrawals.length };
      },
    },
    epochCheckpoint: {
      deleteMany: async ({ where }: { where: Row }) => {
        void where;
        return { count: 0 };
      },
    },
    copyOrder: {
      findMany: async ({ where }: { where?: Row }) => (!where ? [...db.orders] : db.orders.filter((r) => match(r, where))),
      deleteMany: async ({ where }: { where: Row }) => {
        const before = db.orders.length;
        db.orders = db.orders.filter((r) => !match(r, where));
        return { count: before - db.orders.length };
      },
    },
    copyOrderLeg: {
      findMany: async ({ where }: { where: Row }) => db.legs.filter((l) => match(l, where)),
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), closedAt: new Date(), ...data };
        db.legs.push(r);
        return r;
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = db.legs.length;
        db.legs = db.legs.filter((l) => !match(l, where));
        return { count: before - db.legs.length };
      },
    },
    bot: {
      findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row }) => {
        const rows = db.bots.filter((r) => (!where || match(r, where)));
        if (orderBy && 'id' in orderBy) rows.sort((a, b) => (a.id as number) - (b.id as number));
        return rows[rows.length - 1] ?? null;
      },
      findMany: async ({ where }: { where?: Row }) => (!where ? [...db.bots] : db.bots.filter((r) => match(r, where))),
      findUnique: async ({ where }: { where: Row }) => db.bots.find((r) => match(r, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), ...data };
        db.bots.push(r);
        return r;
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = db.bots.length;
        db.bots = db.bots.filter((r) => !match(r, where));
        return { count: before - db.bots.length };
      },
    },
  } as never;
  const copy = {
    executePaper: async (dto: Row, ov: Row) => {
      fired.push({ dto, ov });
      return { id: nid(), status: 'CONFIRMED' };
    },
  } as never;
  const manage = { tick: async () => ({ scanned: fired.length, closedIds: [] }) } as never;
  const vaults = {
    createVault: async (name: string) => {
      const r = { id: nid(), name, traders: [] };
      db.vaults.push(r); // persist so resolveDemoPair finds it (mirrors real service)
      return r;
    },
    assignTrader: async () => ({}),
    deposit: async () => ({ id: nid(), status: 'QUEUED' }),
    settleEpoch: async () => ({ epochId: 1 }),
    requestWithdraw: async () => ({ id: nid(), status: 'QUEUED' }),
    status: async () => ({ lastEpoch: { navSol: 120 } }),
    depositorShares: async () => 100,
  } as never;
  const bots = {
    create: async (name: string) => {
      const r = { id: nid(), name };
      db.bots.push(r); // persist so resolveDemoPair finds it (mirrors real service)
      return r;
    },
  } as never;
  const audit = {
    record: async (input: Row) => {
      audits.push({ id: audits.length + 1, ...input });
      return { id: audits.length };
    },
  } as never;
  const market = { bulkPrices: async () => ({}) } as never;
  const svc = new DemoService(prisma, copy, manage, vaults, bots, audit, market);
  return { svc, audits, fired, db };
}

const SIG = (sig: string, wallet: string): Row => ({
  signature: sig,
  walletAddress: wallet,
  symbol: '$T',
  tokenMint: 'MINT',
  amountUsd: { toNumber: () => 10 },
  dexVenue: 'Titan Meta-DEX',
});

async function main(): Promise<void> {
  // 1. Seed builds vault + traders + bot + deposit + settle + audit.
  {
    const w = makeWorld({ wallets: [{ address: 'WA' }, { address: 'WB' }, { address: 'WC' }] });
    const s = await w.svc.seed({ depositSol: 100, traderCount: 3 }, 'admin');
    assert.ok(s.vaultId > 0 && s.botId > 0);
    assert.deepEqual(s.traders, ['WA', 'WB', 'WC']);
    assert.equal(s.sharePrice, 1);
    assert.equal(w.audits[0].action, 'demo.seed');
  }
  // 2. Seed needs tracked wallets.
  {
    const w = makeWorld({ wallets: [] });
    await assert.rejects(() => w.svc.seed({}, 'admin'), /tracked wallets/);
  }
  // 3. Replay: caps at 3/wallet, simulated executor (no devnet), pending withdraw.
  {
    const signals = [
      SIG('s1', 'WA'), SIG('s2', 'WA'), SIG('s3', 'WA'), SIG('s4', 'WA'), // 4th over cap
      SIG('s5', 'WB'),
    ];
    const w = makeWorld({
      signals,
      vaults: [{ id: 1, name: 'demo-fund-x' }],
      bots: [{ id: 7, name: 'demo-bot-x', vaultId: 1 }],
    });
    const r = await w.svc.replay({ vaultId: 1, botId: 7, days: 7, limit: 30 }, 'admin');
    assert.equal(r.signals, 4); // 3 WA + 1 WB (4th WA dropped by per-wallet cap)
    assert.equal(r.fired, 4);
    assert.equal(r.failed, 0);
    // Simulated path: PAPER enabled override + stub executor shape recorded.
    const first = w.fired[0];
    assert.equal((first.ov as Row).paperEnabled, true);
    assert.equal((first.ov as Row).strict, false);
    assert.equal((first.ov as Row).triggeredBy, 'demo:7');
    // Withdraw stays QUEUED pending.
    assert.equal(r.withdrawal?.pending, true);
    assert.equal(r.withdrawal?.status, 'QUEUED');
    assert.ok((r.withdrawal?.message ?? '').includes('queued'));
    assert.equal(r.environment, 'sandbox');
  }
  // 4. Replay refuses non-demo vaults/bots.
  {
    const w = makeWorld({
      vaults: [{ id: 1, name: 'paper' }],
      bots: [{ id: 2, name: 'live-bot', vaultId: 1 }],
    });
    await assert.rejects(() => w.svc.replay({ vaultId: 1, botId: 2 }, 'admin'), /not a demo/);
  }
  // 5. Reset deletes demo rows only; audit kept + reset row appended.
  {
    const demoOrder = { id: 50, quoteJson: { sized: { triggeredBy: 'demo:7', demo: true } } };
    const liveOrder = { id: 51, quoteJson: { sized: {} } };
    const w = makeWorld({
      vaults: [{ id: 1, name: 'demo-fund-x' }, { id: 2, name: 'paper' }],
      bots: [{ id: 7, name: 'demo-bot-x', vaultId: 1 }],
      orders: [demoOrder, liveOrder],
      legs: [{ id: 60, orderId: 50 }],
    });
    const r = await w.svc.reset('admin');
    assert.equal(r.orders, 1);
    assert.equal(r.legs, 1);
    assert.equal(r.vaults, 1);
    assert.equal(r.bots, 1);
    assert.equal(r.auditKept, true);
    assert.equal(w.db.orders.length, 1);
    assert.equal(w.db.orders[0].id, 51);
    assert.equal(w.db.vaults.length, 1);
    assert.ok(w.audits.some((a) => a.action === 'demo.reset'));
  }
  // 6. Performance aggregates both bot: and demo: orders.
  {
    const w = makeWorld({
      bots: [{ id: 7, name: 'demo-bot-x', vaultId: 1 }],
      orders: [
        { id: 1, status: 'CONFIRMED', realizedPnlUsd: 30, closedAt: new Date('2026-01-02'), symbol: '$A', quoteJson: { sized: { triggeredBy: 'demo:7' } } },
        { id: 2, status: 'CONFIRMED', realizedPnlUsd: -10, closedAt: new Date('2026-01-03'), symbol: '$B', quoteJson: { sized: { triggeredBy: 'demo:7' } } },
        { id: 3, status: 'CONFIRMED', realizedPnlUsd: null, closedAt: null, symbol: '$C', quoteJson: { sized: { triggeredBy: 'bot:7' } } },
        { id: 4, status: 'CONFIRMED', realizedPnlUsd: 5, closedAt: new Date('2026-01-04'), symbol: '$D', quoteJson: { sized: { triggeredBy: 'bot:9' } } },
      ],
    });
    const p = await w.svc.performance(7);
    assert.equal(p.orders, 3);
    assert.equal(p.closed, 2);
    assert.equal(p.wins, 1);
    assert.equal(p.losses, 1);
    assert.equal(p.winRate, 50);
    assert.equal(p.totalRealizedUsd, 20);
    assert.deepEqual((p.equity as Row[]).map((e) => e.cum), [30, 20]);
  }
  // 7. Performance on missing bot → 404 envelope.
  {
    const w = makeWorld({ bots: [] });
    await assert.rejects(() => w.svc.performance(999), /not found/);
  }
  // 8. Scenario: reset first, then 3 cases in parallel, each seed+replay.
  {
    const signals = [
      SIG('s1', 'WA'), SIG('s2', 'WA'), SIG('s3', 'WA'),
      SIG('s4', 'WB'), SIG('s5', 'WB'), SIG('s6', 'WB'),
    ];
    const w = makeWorld({
      wallets: [{ address: 'WA' }, { address: 'WB' }, { address: 'WC' }, { address: 'WD' }, { address: 'WE' }],
      signals,
      vaults: [{ id: 1, name: 'demo-fund-old' }],
      bots: [{ id: 7, name: 'demo-bot-old', vaultId: 1 }],
    });
    const r = await w.svc.scenario('admin');
    assert.equal(r.cleaned.vaults, 1); // stale demo pool wiped first
    assert.equal(r.cases.length, 3);
    const names = r.cases.map((c) => c.name).sort();
    assert.deepEqual(names, ['case-broad', 'case-momentum', 'case-value']);
    for (const c of r.cases) {
      assert.equal(c.ok, true);
      if (c.ok) {
        assert.ok(c.vaultId > 0 && c.fired > 0);
        assert.equal(c.withdrawal?.pending, true); // vault trừ tiền: rút QUEUED
      }
    }
    assert.ok(w.audits.some((a) => a.action === 'demo.scenario'));
    assert.equal(r.environment, 'sandbox');
  }

  console.log('demo asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
