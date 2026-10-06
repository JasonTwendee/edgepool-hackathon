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

  // 2. Authed: myHolding attached.
  const authed = ((await svc.pools({ id: 7, wallet: 'cred:alice' })) as Row[])[0] as Row;
  assert.deepEqual(authed.myHolding, { shares: 10, valueSol: 11, returnsSol: 1 });

  // 3. NAV engine: last NAV + unrealized MTM + realized since last epoch.
  // Epoch NAV 10 (9d ago). Open BUY: $5 @ $1 → live $2 ⇒ +$5 unrealized.
  // Closed after epoch: +$2 realized. Expect 17.
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

  console.log('pools asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
