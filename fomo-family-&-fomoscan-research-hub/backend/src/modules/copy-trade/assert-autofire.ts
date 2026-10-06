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
      return 0;
    },
    findFirst: async ({ where }: { where: Row }) =>
      orders.find((o) => o.masterTxHash === (where as Row).masterTxHash) ?? null,
  };
  const prisma = {
    bot: {
      findMany: async ({ where }: { where: Row }) =>
        cfg.bots.filter((b) => (where as Row).mode === undefined || b.mode === (where as Row).mode),
    },
    transaction: { findMany: async () => [...cfg.signals] },
    vaultTrader: {
    findMany: async ({ where }: { where: { vaultId: { in: number[] }; isActive: boolean } }) =>
      cfg.traders.filter((t) => where.vaultId.in.includes(t.vaultId as number) && t.isActive === where.isActive),
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
  const stubExecutor = {
    assertDevnet: async () => undefined,
    fetchQuote: async () => ({ outAmount: '119344', otherAmountThreshold: '118748' }),
    loadVaultKeypair: () => Keypair.generate(),
    executeProof: async () => ({ signature: 'z'.padEnd(88, '9'), slot: 7 }),
  } as never;
  const copy = new CopyTradeService(
    prisma,
    stubExecutor,
    { qualify: async () => ({ pass: true, reasons: [], verdict: {} }) } as never,
    { bulkPrices: async () => ({}), tokenDetails: async () => null, candles: async () => [] } as never,
    { status: async () => ({ lastEpoch: null }) } as never,
  );
  const engine = new AutoFireService(prisma, copy, new AuditService(prisma));
  engine.overrides = { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never };
  return { engine, orders, audits, creates: () => creates };
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

  console.log('autofire asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
