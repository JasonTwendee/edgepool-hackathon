/**
 * Executable evidence for T1 (auto-fire engine).
 * Run: `npx tsx src/modules/copy-trade/assert-autofire.ts` (mocked, no network).
 */
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { CopyTradeService } from './copy-trade.service.js';
import { AutoFireService } from './auto-fire.service.js';
import { AuditService } from '../audit/audit.service.js';

type Row = Record<string, unknown>;
const dec = (n: number): { toNumber: () => number } => ({ toNumber: () => n });

function makeWorld(cfg: {
  bots: Row[];
  signals: Row[];
  traders: Row[];
  wallets: Row[];
  liveCounts?: { trader: number; mint: number };
  existingOrders?: Row[];
  vaults?: Row[];
  epochs?: Row[];
  lastEpoch?: { navSol: number } | null;
  wsolPx?: number;
  candles?: Row[];
}) {
  const orders: Row[] = [...(cfg.existingOrders ?? [])];
  let seq = 100;
  let creates = 0;
  const audits: Row[] = [];
  const copyOrder = {
    create: async ({ data }: { data: Row }) => {
      creates++;
      const r = { id: (seq += 1), status: 'PENDING', createdAt: new Date(), ...data };
      orders.push(r);
      return r;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = orders.find((x) => x.id === where.id) as Row;
      Object.assign(r, data);
      return r;
    },
    count: async ({ where }: { where: Row }) => {
      if ((where as Row).masterWallet) return cfg.liveCounts?.trader ?? 0;
      if ((where as Row).symbol) return cfg.liveCounts?.mint ?? 0;
      const w = (where ?? {}) as Row;
      if (w.vaultId !== undefined) {
        return orders.filter(
          (o) =>
            o.vaultId === w.vaultId &&
            (w.status === undefined || o.status === w.status) &&
            (!('closedAt' in w) || (w.closedAt === null ? o.closedAt == null : true)),
        ).length;
      }
      return 0;
    },
    findFirst: async ({ where }: { where: Row }) =>
      orders.find((o) => o.masterTxHash === (where as Row).masterTxHash) ?? null,
    findMany: async ({ where }: { where: Row }) => {
      const w = (where ?? {}) as Row;
      return orders.filter(
        (o) =>
          (w.vaultId === undefined || o.vaultId === w.vaultId) &&
          (w.tokenMint === undefined || o.tokenMint === w.tokenMint) &&
          (w.status === undefined || o.status === w.status) &&
          (!('closedAt' in w) || (w.closedAt === null ? o.closedAt == null : true)) &&
          (!(w.masterWallet !== undefined) || o.masterWallet === w.masterWallet),
      );
    },
  };
  const prisma = {
    bot: {
      findMany: async ({ where }: { where: Row }) =>
        cfg.bots.filter((b) => (where as Row).mode === undefined || b.mode === (where as Row).mode),
    },
    transaction: { findMany: async () => [...cfg.signals] },
    vaultTrader: {
    findMany: async ({ where }: { where: { vaultId: { in: number[] }; isActive: boolean } }) =>
      cfg.traders.filter((t) => (typeof where.vaultId === 'number' ? t.vaultId === where.vaultId : where.vaultId.in.includes(t.vaultId as number)) && t.isActive === where.isActive),
    },
    trackedWallet: { findMany: async () => [...cfg.wallets] },
    vault: {
      findMany: async ({ where }: { where?: Row }) => {
        const ids = ((where as Row)?.id as { in?: number[] } | undefined)?.in;
        const rows = cfg.vaults ?? [{ id: 1, status: 'live', rulesJson: null }];
        return ids ? rows.filter((v) => ids.includes(v.id as number)) : [...rows];
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = cfg.vaults ?? [];
        const r = rows.find((v) => v.id === where.id);
        if (r) Object.assign(r, data);
        return r ?? { id: where.id, ...data };
      },
    },
    epochCheckpoint: {
      findMany: async ({ where }: { where?: Row }) => {
        const ids = ((where as Row)?.vaultId as { in?: number[] } | undefined)?.in;
        const rows = cfg.epochs ?? [];
        const out = ids ? rows.filter((e) => ids.includes(e.vaultId as number)) : [...rows];
        out.sort((a, b) => (a.id as number) - (b.id as number));
        return out;
      },
    },
    copyOrder,
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
  const quotes: Row[] = [];
  const stubExecutor = {
    assertDevnet: async () => undefined,
    fetchQuote: async (params: Row) => { quotes.push(params); return { outAmount: '119344', otherAmountThreshold: '118748' }; },
    loadVaultKeypair: () => Keypair.generate(),
    executeProof: async () => ({ signature: 'z'.padEnd(88, '9'), slot: 7 }),
  } as never;
  const WSOL = 'So11111111111111111111111111111111111111112';
  const copy = new CopyTradeService(
    prisma,
    stubExecutor,
    { qualify: async () => ({ pass: true, reasons: [], verdict: {} }) } as never,
    { bulkPrices: async (mints: string[]) => (mints.includes(WSOL) ? { [WSOL]: cfg.wsolPx ?? 100 } : {}), tokenDetails: async () => null, candles: async () => cfg.candles ?? [] } as never,
    { status: async () => ({ lastEpoch: cfg.lastEpoch ?? null }) } as never,
  );
  const engine = new AutoFireService(prisma, copy, new AuditService(prisma));
  engine.overrides = { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never };
  return { engine, copy, orders, audits, quotes, creates: () => creates };
}

const SIG = {
  signature: 'sigTEST11111111111111111111111111111111111111111111111111111111',
  walletAddress: 'MasterWallet11111111111111111111111111111111111',
  symbol: '$TEST',
  tokenMint: 'Mint111111111111111111111111111111111111111111',
  amountUsd: dec(10),
  dexVenue: 'Titan Meta-DEX',
  blockTime: 1,
};
const TRADER = { id: 1, vaultId: 1, wallet: SIG.walletAddress, isActive: true };
const BOT = { id: 7, name: 'auto-1', mode: 'AUTO', vaultId: 1 };
const WSOL = 'So11111111111111111111111111111111111111112';

async function main(): Promise<void> {
  // 1. No AUTO bots → zeros, no orders.
  {
    const w = makeWorld({ bots: [], signals: [SIG], traders: [TRADER], wallets: [] });
    const s = await w.engine.tick();
    assert.equal(s.fired, 0);
    assert.equal(s.note, 'no-auto-bots');
    assert.equal(w.creates(), 0);
  }
  // 2. PAUSED bot → silent.
  {
    const w = makeWorld({ bots: [{ ...BOT, mode: 'PAUSED' }], signals: [SIG], traders: [TRADER], wallets: [] });
    const s = await w.engine.tick();
    assert.equal(s.fired, 0);
    assert.equal(w.creates(), 0);
  }
  // 3. Fresh signal → CONFIRMED + triggeredBy + audit actor bot:7.
  {
    const w = makeWorld({ bots: [BOT], signals: [SIG], traders: [TRADER], wallets: [] });
    const s = await w.engine.tick();
    assert.equal(s.fired, 1);
    assert.deepEqual(s.orderIds.length, 1);
    const row = w.orders.find((o) => o.id === s.orderIds[0]) as Row;
    assert.equal(row.status, 'CONFIRMED');
    assert.equal((row.quoteJson as Row).sized !== undefined, true);
    assert.equal(((row.quoteJson as Row).sized as Row).triggeredBy, 'bot:7');
    assert.equal(w.audits.length, 1);
    assert.equal((w.audits[0] as Row).actor, 'bot:7');
    assert.equal((w.audits[0] as Row).action, 'copy.auto_fire');
    // 4. Re-tick dedupes by masterTxHash.
    const s2 = await w.engine.tick();
    assert.equal(s2.fired, 0);
    assert.equal(s2.skippedDedupe, 1);
  }
  // 5. Signal outside vault scope → skippedNoScope.
  {
    const w = makeWorld({
      bots: [BOT],
      signals: [{ ...SIG, walletAddress: 'Stranger11111111111111111111111111111111111' }],
      traders: [TRADER],
      wallets: [],
    });
    const s = await w.engine.tick();
    assert.equal(s.skippedNoScope, 1);
    assert.equal(w.creates(), 0);
  }
  // 6. Exposure cap (pre-create gate) → blocked, no order row, no crash.
  {
    const w = makeWorld({
      bots: [BOT],
      signals: [SIG],
      traders: [TRADER],
      wallets: [],
      liveCounts: { trader: 3, mint: 0 },
    });
    const s = await w.engine.tick();
    assert.equal(s.fired, 0);
    assert.equal(s.blocked, 1);
    assert.equal(w.creates(), 0);
  }
  // 7. Loop kill-switch: interval 0 → no timer.
  {
    const w = makeWorld({ bots: [], signals: [], traders: [], wallets: [] });
    const prev = process.env.COPY_AUTO_INTERVAL_MS;
    process.env.COPY_AUTO_INTERVAL_MS = '0';
    w.engine.onModuleInit();
    assert.equal((w.engine as unknown as Row).timer, undefined);
    if (prev === undefined) delete process.env.COPY_AUTO_INTERVAL_MS;
    else process.env.COPY_AUTO_INTERVAL_MS = prev;
  }
  // 8. Fix #6: day −6% halts vault — 0 fired, paused, audited.
  {
    const now = Date.now();
    const w = makeWorld({
      bots: [BOT],
      signals: [SIG],
      traders: [TRADER],
      wallets: [],
      vaults: [{ id: 1, status: 'live', rulesJson: null }],
      epochs: [
        { id: 1, vaultId: 1, navSol: 100, createdAt: new Date(now - 2 * 86400000) },
        { id: 2, vaultId: 1, navSol: 94, createdAt: new Date(now - 3600000) },
      ],
    });
    const s = await w.engine.tick();
    assert.equal(s.fired, 0);
    assert.deepEqual(s.haltedVaults, [1]);
    assert.equal((w as unknown as { audits: Row[] }).audits.some((a) => a.action === 'copy.kill_switch_halt'), true);
    assert.equal(w.creates(), 0);
  }
  // 9. Paused vault never fires (no new audit row needed).
  {
    const w = makeWorld({
      bots: [BOT],
      signals: [SIG],
      traders: [TRADER],
      wallets: [],
      vaults: [{ id: 1, status: 'paused', rulesJson: null }],
      epochs: [],
    });
    const s = await w.engine.tick();
    assert.equal(s.fired, 0);
    assert.deepEqual(s.haltedVaults, [1]);
    assert.equal(w.creates(), 0);
  }
  // 10. ATR unpin: with candles, the engine tunes TP1/stop (not pinned 60/30).
  {
    const wild = Array.from({ length: 20 }, (_, i) => ({
      open: 100, high: 150, low: 50, close: 100, volume: 1, timestamp: i,
    }));
    const w = makeWorld({ bots: [BOT], signals: [SIG], traders: [TRADER], wallets: [], candles: wild });
    const s = await w.engine.tick();
    assert.equal(s.fired, 1);
    const row = w.orders.find((o) => o.id === s.orderIds[0]) as Row;
    assert.equal(row.tp1Pct, 80); // wild regime: stop 40 → TP1 80 (was pinned 60)
    assert.equal(row.stopPct, 40);
  }
  // 11. Max 10 open positions per vault → blocked.
  {
    const w = makeWorld({ bots: [BOT], signals: [SIG], traders: [TRADER], wallets: [] });
    for (let i = 0; i < 10; i++) {
      w.orders.push({ id: 200 + i, vaultId: 1, status: 'CONFIRMED', closedAt: null, masterTxHash: `old${i}`, symbol: '$OLD', tokenMint: `MOLD${i}`, amountUsd: 10 });
    }
    const s = await w.engine.tick();
    assert.equal(s.fired, 0);
    assert.equal(s.blocked, 1);
    assert.equal(w.creates(), 0);
  }
  // 12. Per-mint 2% NAV value cap → blocked (mint already holds the budget).
  {
    const w = makeWorld({
      bots: [BOT],
      signals: [SIG],
      traders: [TRADER],
      wallets: [],
      lastEpoch: { navSol: 10 },
      wsolPx: 100, // navUsd = 1000 → mint budget $20
      existingOrders: [
        { id: 301, vaultId: 1, status: 'CONFIRMED', closedAt: null, masterTxHash: 'oldm', symbol: '$TEST', tokenMint: SIG.tokenMint, amountUsd: 15 },
      ],
    });
    const s = await w.engine.tick();
    assert.equal(s.fired, 0);
    assert.equal(s.blocked, 1);
    assert.equal(w.creates(), 0);
  }
  // 13. executePaper kill gate: breached vault refuses even direct entries.
  {
    const now = Date.now();
    const w = makeWorld({
      bots: [],
      signals: [],
      traders: [TRADER],
      wallets: [],
      vaults: [{ id: 1, status: 'live', rulesJson: null }],
      epochs: [
        { id: 1, vaultId: 1, navSol: 100, createdAt: new Date(now - 2 * 86400000) },
        { id: 2, vaultId: 1, navSol: 94, createdAt: new Date(now - 3600000) },
      ],
    });
    const copy = w.copy as unknown as {
      executePaper: (dto: Record<string, unknown>, ov: Record<string, unknown>) => Promise<unknown>;
    };
    await assert.rejects(
      () =>
        copy.executePaper(
          { masterWallet: SIG.walletAddress, masterTxHash: 'sigK', symbol: '$TEST', action: 'BUY', tokenMint: SIG.tokenMint, amountUsd: 10, mode: 'paper', confirm: true },
          { paperEnabled: true, maxUsd: 100, executor: (w.engine.overrides as Record<string, unknown>).executor, connection: {}, vaultId: 1 },
        ),
      /Kill-switch/,
    );
    assert.equal(w.creates(), 0);
  }

  // Small pools size the copied allocation, not the source-wallet trade.
  {
    const traders = Array.from({ length: 5 }, (_, i) => ({ ...TRADER, wallet: i ? `W${i}` : SIG.walletAddress, weightBps: 2000 }));
    const w = makeWorld({ bots: [BOT], signals: [{ ...SIG, amountUsd: dec(1000) }], traders, wallets: [], lastEpoch: { navSol: 1 }, wsolPx: 100 });
    const result = await w.engine.tick();
    assert.equal(result.fired, 1);
    const order = w.orders.find((o) => o.id === result.orderIds[0])!;
    assert.equal(order.amountUsd, 0.2);
    assert.equal(w.quotes[0].amount, '2000000');
    assert.equal(w.quotes[0].outputMint, SIG.tokenMint);
    // A second allocation exactly reaching the 2% mint cap is allowed.
    const boundary = makeWorld({ bots: [BOT], signals: [SIG], traders, wallets: [], lastEpoch: { navSol: 1 }, wsolPx: 100,
      existingOrders: [{ id: 500, vaultId: 1, status: 'CONFIRMED', closedAt: null, symbol: '$OTHER', tokenMint: SIG.tokenMint, amountUsd: 1.8 }] });
    assert.equal((await boundary.engine.tick()).fired, 1);
    const over = makeWorld({ bots: [BOT], signals: [SIG], traders, wallets: [], lastEpoch: { navSol: 1 }, wsolPx: 100,
      existingOrders: [{ id: 500, vaultId: 1, status: 'CONFIRMED', closedAt: null, symbol: '$OTHER', tokenMint: SIG.tokenMint, amountUsd: 1.81 }] });
    assert.equal((await over.engine.tick()).blocked, 1);
    const partial = makeWorld({ bots: [BOT], signals: [SIG], traders, wallets: [], lastEpoch: { navSol: 1 }, wsolPx: 100,
      existingOrders: [{ id: 501, vaultId: 1, status: 'CONFIRMED', closedAt: null, symbol: '$OTHER', tokenMint: SIG.tokenMint, amountUsd: 3.6, legs: [{ fraction: 0.5 }] }] });
    assert.equal((await partial.engine.tick()).fired, 1);
    const dust = makeWorld({ bots: [BOT], signals: [SIG], traders, wallets: [], lastEpoch: { navSol: 0.001 }, wsolPx: 100 });
    assert.equal((await dust.engine.tick()).fired, 0);
    assert.equal(dust.creates(), 0);
    const unpriced = makeWorld({ bots: [BOT], signals: [SIG], traders, wallets: [], lastEpoch: { navSol: 1 }, wsolPx: Number.NaN });
    assert.equal((await unpriced.engine.tick()).fired, 0);
    assert.equal(unpriced.quotes.length, 0);

  }

  console.log('autofire asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
