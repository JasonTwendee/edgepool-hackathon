/**
 * Executable evidence for pool app P1.1 (pools index).
 * Run: `npx tsx src/modules/vaults/assert-pools.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService } from './vault.service.js';

type Row = Record<string, unknown>;

function makeFake() {
  const now = Date.now();
  const db = {
    vault: [
      { id: 1, name: 'flagship', kind: 'basket', status: 'live', listing: 'public', feeBps: 2000, hwmSharePrice: 1.1, totalShares: 10, maxSlots: 100, maxTraders: 5, environment: 'SANDBOX', createdAt: new Date(now - 30 * 86400000) },
      { id: 2, name: 'partner-x', kind: 'partner', status: 'paused', listing: 'unlisted', feeBps: 2000, hwmSharePrice: 1, totalShares: 0, maxSlots: 20, maxTraders: 3, environment: 'SANDBOX', createdAt: new Date(now - 30 * 86400000) },
    ] as Row[],
    traders: [
      { id: 1, vaultId: 1, wallet: 'W1', weightBps: 5000, isActive: true },
      { id: 2, vaultId: 1, wallet: 'W2', weightBps: 5000, isActive: true },
      { id: 3, vaultId: 1, wallet: 'W9', weightBps: 0, isActive: false },
    ] as Row[],
    tracked: [
      { address: 'W1', label: 'T1', handle: 't1', fomoRank: 3 },
      { address: 'W2', label: 'T2', handle: 't2', fomoRank: 7 },
    ] as Row[],
    epochs: [
      { id: 1, vaultId: 1, navSol: 10, sharePrice: 1, createdAt: new Date(now - 10 * 86400000) },
      { id: 2, vaultId: 1, navSol: 11, sharePrice: 1.1, createdAt: new Date(now - 86400000) },
    ] as Row[],
    deposits: [
      { id: 1, vaultId: 1, depositor: 'alice', userId: 7, amountSol: 10, status: 'SETTLED', sharesMinted: 10, sharePrice: 1, createdAt: new Date(now - 9 * 86400000), settledAt: new Date(now - 9 * 86400000) },
      { id: 2, vaultId: 1, depositor: 'bob', userId: null, amountSol: 5, status: 'SETTLED', sharesMinted: 5, sharePrice: 1, createdAt: new Date(now - 8 * 86400000), settledAt: new Date(now - 8 * 86400000) },
    ] as Row[],
    withdrawals: [] as Row[],
  };
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'OR' && Array.isArray(v)) return (v as Row[]).some((o) => match(r, o));
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const prisma = {
    vault: {
      findMany: async () => [...db.vault],
      findUnique: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
    },
    vaultTrader: {
      findMany: async ({ where }: { where: Row }) => db.traders.filter((r) => match(r, where)),
    },
    trackedWallet: {
      findMany: async ({ where }: { where: Row }) => {
        const addrs = ((where.address as Row)?.in as string[]) ?? [];
        return db.tracked.filter((r) => addrs.includes(r.address as string));
      },
    },
    epochCheckpoint: {
      findFirst: async ({ where }: { where: Row }) => {
        const rows = db.epochs.filter((r) => match(r, where));
        return rows[rows.length - 1] ?? null;
      },
      findMany: async ({ where }: { where: Row }) => db.epochs.filter((r) => match(r, where)),
    },
    deposit: {
      findMany: async ({ where }: { where: Row }) => db.deposits.filter((r) => match(r, where)),
    },
    withdrawal: {
      findMany: async () => [...db.withdrawals],
    },
    partnerPayout: {
      aggregate: async () => ({ _sum: { amountSol: null } }),
    },
  } as never;
  return { prisma };
}

async function main(): Promise<void> {
  const now = Date.now();
  const svc = new VaultService(makeFake().prisma);

  // 1. Anonymous: two pools, fields + snapshot pnl + slots + basket.
  const anon = (await svc.pools()) as Row[];
  assert.equal(anon.length, 2);
  const flagship = anon[0] as Row;
  assert.equal(flagship.kind, 'basket');
  assert.equal(flagship.status, 'live');
  assert.equal((flagship.slots as Row).used, 2);
  assert.equal(((flagship.traders as Row[]).length), 2); // inactive W9 excluded
  assert.equal(((flagship.traders as Row[])[0] as Row).rank, 3);
  assert.ok(!('myHolding' in flagship));
  const week = (flagship.pnl as Row).week as Row;
  assert.equal(week.sol, 1); // 11 - 10
  const paused = anon[1] as Row;
  assert.equal(paused.status, 'paused');
  assert.equal(paused.listing, 'unlisted');

  // 1b. Genesis 0-NAV checkpoint is never the PnL base: a young pool funded
  // 12 → now 12.96 reports +0.96 / +8%, never "+12.96 at +0.0%".
  {
    const gFake = {
      vault: [{ id: 3, name: 'genesis', kind: 'partner', status: 'live', listing: 'public', feeBps: 0, hwmSharePrice: 1, totalShares: 10, maxSlots: 50, maxTraders: 3, environment: 'SANDBOX', createdAt: new Date(now - 3600000) }],
      traders: [] as Row[],
      tracked: [] as Row[],
      epochs: [
        { id: 1, vaultId: 3, navSol: 0, sharePrice: 1, createdAt: new Date(now - 3600000) },
        { id: 2, vaultId: 3, navSol: 12, sharePrice: 1.2, createdAt: new Date(now - 1800000) },
        { id: 3, vaultId: 3, navSol: 12.96, sharePrice: 1.296, createdAt: new Date(now - 60000) },
      ] as Row[],
      deposits: [] as Row[],
      withdrawals: [] as Row[],
    };
    const gMatch = (r: Row, w: Row): boolean =>
      Object.entries(w).every(([k, v]) => {
        if (v !== null && typeof v === 'object') return true;
        return r[k] === v;
      });
    const gPrisma = {
      vault: {
        findMany: async () => [...gFake.vault],
        findUnique: async ({ where }: { where: Row }) => gFake.vault.find((r) => gMatch(r, where)) ?? null,
      },
      vaultTrader: { findMany: async () => [] },
      trackedWallet: { findMany: async () => [] },
      epochCheckpoint: {
        findFirst: async () => gFake.epochs[gFake.epochs.length - 1],
        findMany: async () => [...gFake.epochs],
      },
      deposit: { findMany: async () => [] },
      withdrawal: { findMany: async () => [] },
      partnerPayout: { aggregate: async () => ({ _sum: { amountSol: null } }) },
    } as never;
    const gPools = (await new VaultService(gPrisma).pools()) as Row[];
    const gWeek = (gPools[0].pnl as Row).week as Row;
    assert.equal(gWeek.sol, 0.96);
    assert.equal(gWeek.pct, 8);
  }

  // 2. Authed: myHolding attached.
  const authed = ((await svc.pools({ id: 7, wallet: 'cred:alice' })) as Row[])[0] as Row;
  assert.deepEqual(authed.myHolding, { shares: 10, valueSol: 11, returnsSol: 1 });

  // 3. NAV engine: last NAV + unrealized MTM + realized since last epoch.
  const db3 = {
    vault: [{ id: 9, name: 'nav', kind: 'basket', status: 'live', listing: 'public', feeBps: 0, hwmSharePrice: 1, totalShares: 10, maxSlots: 100, maxTraders: 5, environment: 'SANDBOX', createdAt: new Date(now - 30 * 86400000) }],
    orders: [
      { id: 1, vaultId: 9, action: 'BUY', tokenMint: 'M1', amountUsd: 5, entryPriceUsd: 1, closedAt: null },
      { id: 2, vaultId: 9, action: 'BUY', tokenMint: 'M1', amountUsd: 4, entryPriceUsd: 1, realizedPnlUsd: 2, closedAt: new Date(now - 86400000) },
      { id: 3, vaultId: 99, action: 'BUY', tokenMint: 'M1', amountUsd: 100, entryPriceUsd: 1, closedAt: null },
    ],
    epochs3: [{ id: 1, vaultId: 9, navSol: 10, sharePrice: 1, createdAt: new Date(now - 9 * 86400000) }],
  };
  const match3 = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'OR' && Array.isArray(v)) return (v as Row[]).some((o) => match3(r, o));
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const prisma3 = {
    vault: {
      findUnique: async ({ where }: { where: Row }) => db3.vault.find((r) => match3(r, where)) ?? null,
    },
    epochCheckpoint: {
      findFirst: async ({ where }: { where: Row }) => db3.epochs3.filter((r) => match3(r, where)).pop() ?? null,
    },
    copyOrder: {
      findMany: async ({ where }: { where: Row }) => db3.orders.filter((r) => match3(r, where)),
    },
  } as never;
  const navSvc = new VaultService(prisma3, { bulkPrices: async () => ({ M1: 2 }) } as never);
  assert.equal(await navSvc.computeNav(9), 17);
  // No prices provider → unrealized skipped, base + realized only.
  const navSvc2 = new VaultService(prisma3);
  assert.equal(await navSvc2.computeNav(9), 12);

  // 4. Deposit gates: min 0.5 SOL + slots (full blocks newcomers only).
  const gateDb: { vault: Row[]; deposits: Row[] } = {
    vault: [{ id: 5, maxSlots: 1 }],
    deposits: [{ depositor: 'holder', status: 'SETTLED' }],
  };
  const gatePrisma = {
    vault: {
      findUnique: async (_w: never) => gateDb.vault[0],
    },
    epochCheckpoint: {
      findMany: async () => [],
    },
    deposit: {
      findMany: async (_w?: never) => [...gateDb.deposits],
      create: async ({ data }: { data: Row }) => {
        const r = { id: gateDb.deposits.length + 1, ...data };
        gateDb.deposits.push(r);
        return r;
      },
    },
  } as never;
  const gateSvc = new VaultService(gatePrisma);
  // resolveVault needs findUnique — id 5 exists.
  await assert.rejects(() => gateSvc.deposit(5, 'newcomer', 0.4), /Minimum deposit/);
  await assert.rejects(() => gateSvc.deposit(5, 'newcomer', 1), /full/);
  const ok = await gateSvc.deposit(5, 'holder', 1);
  assert.equal(ok.status, 'QUEUED');

  // 5. poolDetail: masked when holding < 0.5; positions/signals/log/exposure present.
  const dFake = {
    vault: { findMany: async () => [], findUnique: async () => null },
    vaultTrader: { findMany: async () => [] },
    trackedWallet: { findMany: async () => [] },
    epochCheckpoint: {
      findFirst: async () => null,
      findMany: async () => [{ id: 1, vaultId: 9, navSol: 10, sharePrice: 1, createdAt: new Date(now - 86400000) }],
    },
    deposit: { findMany: async () => [] },
    withdrawal: { findMany: async () => [] },
    partnerPayout: { aggregate: async () => ({ _sum: { amountSol: null } }) },
    copyOrder: {
      findMany: async ({ where }: { where: Row }) =>
        !where || (where as Row).vaultId === 9
          ? [
              { id: 1, vaultId: 9, status: 'CONFIRMED', symbol: 'T1', masterHandle: 't1', masterWallet: 'W1', tokenMint: 'M1', amountUsd: 10, entryPriceUsd: 1, closeReason: null, closedAt: null, quoteJson: { qualify: true }, error: null, createdAt: new Date(now - 3600000) },
              { id: 2, vaultId: 9, status: 'FAILED', symbol: 'T2', masterHandle: 't2', masterWallet: 'W2', tokenMint: null, amountUsd: 5, entryPriceUsd: null, closeReason: null, closedAt: null, quoteJson: {}, error: 'gate', createdAt: new Date(now - 7200000) },
            ]
          : [],
    },
    copyOrderLeg: { findMany: async () => [{ orderId: 1, leg: 'TP1' }] },
  } as never;
  // minimal pools() stub path: reuse real pools() via tiny vault row
  const dSvc = new VaultService(dFake, { bulkPrices: async () => ({ M1: 2 }) } as never);
  // resolveVault(1) fails (no vault) — point at vault id through stub:
  const dFake2 = {
    ...(dFake as unknown as Record<string, unknown>),
    vault: {
      findMany: async () => [{ id: 9, name: 'd', kind: 'basket', status: 'live', listing: 'public', feeBps: 0, hwmSharePrice: 1, totalShares: 10, maxSlots: 100, maxTraders: 5, environment: 'SANDBOX', createdAt: new Date(now - 30 * 86400000) }],
      findUnique: async () => ({ id: 9, name: 'd', kind: 'basket', status: 'live', listing: 'public', feeBps: 0, hwmSharePrice: 1, totalShares: 10, maxSlots: 100, maxTraders: 5, environment: 'SANDBOX', createdAt: new Date(now - 30 * 86400000) }),
    },
  } as never;
  const dSvc2 = new VaultService(dFake2, { bulkPrices: async () => ({ M1: 2 }) } as never);
  const det = (await dSvc2.poolDetail(9)) as Row;
  assert.equal((det.openPositions as Row[]).length, 1);
  assert.equal((((det.openPositions as Row[])[0] as Row).unrealizedPct as number), 100); // 10→20 on $10
  assert.equal((det.signals as Row[]).length, 2);
  assert.equal(det.masked, true); // no user → masked
  // Paywall: tokens/traders/sizes masked server-side, % PnL stays visible.
  assert.equal((((det.openPositions as Row[])[0] as Row).token as string), '$••••');
  assert.equal((((det.openPositions as Row[])[0] as Row).unrealizedPct as number), 100);
  assert.equal((((det.openPositions as Row[])[0] as Row).sizeSol as null), null);
  assert.equal((((det.signals as Row[])[0] as Row).token as string), '$••••');
  assert.ok(Array.isArray(det.navSeries) && (det.navSeries as Row[]).length === 1);
  const adv = det.advanced as Row;
  assert.ok(adv && typeof (adv.kpis as Row).deployedPctNav === 'number');
  assert.ok(Array.isArray(adv.ladder) && (adv.ladder as Row[]).length === 1);
  assert.equal((((adv.ladder as Row[])[0] as Row).tp1Hit as boolean), true);
  assert.equal((((adv.ladder as Row[])[0] as Row).token as string), '$••••');
  // 5b. Queued deposit ≥ 0.5 unlocks signals before settle (prototype behavior).
  const dFake3 = {
    ...(dFake2 as unknown as Record<string, unknown>),
    deposit: {
      findMany: async ({ where }: { where: Row }) =>
        JSON.stringify(where ?? {}).includes('7')
          ? [{ id: 9, vaultId: 9, depositor: 'alice', userId: 7, amountSol: 1, status: 'QUEUED', sharesMinted: 0, sharePrice: 1, createdAt: new Date(now - 60000) }]
          : [],
    },
  } as never;
  const dSvc3 = new VaultService(dFake3, { bulkPrices: async () => ({ M1: 2 }) } as never);
  const det3 = (await dSvc3.poolDetail(9, { id: 7, wallet: 'alice' })) as Row;
  assert.equal(det3.masked, false);
  assert.equal((((det3.openPositions as Row[])[0] as Row).token as string), 'T1');
  void dSvc;

  console.log('pools asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
