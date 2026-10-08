/**
 * Executable evidence for pool app P3 (portfolio overview + cancel withdrawal).
 * Run: `npx tsx src/modules/vaults/assert-portfolio.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService } from './vault.service.js';

type Row = Record<string, unknown>;

function makeFake() {
  const db = {
    vault: [
      { id: 1, name: 'p1', kind: 'basket', status: 'live', listing: 'public', feeBps: 0, hwmSharePrice: 1, totalShares: 10, maxSlots: 100, maxTraders: 5, environment: 'SANDBOX', settlePeriodHours: 0, settleLengthMin: 0, reserveBps: 0, withdrawFeeBps: 0, lockHours: 0, treasurySol: 0, createdAt: new Date('2026-01-01') },
    ] as Row[],
    deposits: [
      { id: 1, vaultId: 1, depositor: 'alice', userId: 7, amountSol: 10, status: 'SETTLED', sharesMinted: 10, sharePrice: 1, createdAt: new Date('2026-02-01'), settledAt: new Date('2026-02-01') },
    ] as Row[],
    withdrawals: [
      { id: 9, vaultId: 1, depositor: 'alice', userId: 7, sharesRequested: 2, status: 'QUEUED', sharePrice: null, payoutSol: null, createdAt: new Date('2026-03-01'), settledAt: null },
      { id: 10, vaultId: 1, depositor: 'bob', userId: null, sharesRequested: 1, status: 'QUEUED', sharePrice: null, payoutSol: null, createdAt: new Date('2026-03-01'), settledAt: null },
    ] as Row[],
    orders: [
      { id: 1, vaultId: 1, status: 'CONFIRMED', symbol: 'T1', masterHandle: 't1', masterWallet: 'W1', tokenMint: 'M1', amountUsd: 100, entryPriceUsd: 1, closeReason: null, closedAt: null, createdAt: new Date('2026-03-02') },
    ] as Row[],
    epochs: [{ id: 1, vaultId: 1, navSol: 12, sharePrice: 1.2, sharesOutstanding: 10, feeSol: 0, createdAt: new Date('2026-03-01') }] as Row[],
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
    deposit: {
      findMany: async ({ where }: { where: Row }) => db.deposits.filter((r) => match(r, where)),
      count: async ({ where }: { where: Row }) => db.deposits.filter((r) => match(r, where)).length,
    },
    withdrawal: {
      findMany: async ({ where }: { where: Row }) => db.withdrawals.filter((r) => match(r, where)),
      findUnique: async ({ where }: { where: Row }) => db.withdrawals.find((r) => match(r, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.withdrawals.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
      count: async ({ where }: { where: Row }) => db.withdrawals.filter((r) => match(r, where)).length,
    },
    epochCheckpoint: {
      findFirst: async ({ where }: { where: Row }) => db.epochs.filter((r) => match(r, where)).pop() ?? null,
      findMany: async ({ where }: { where: Row }) => db.epochs.filter((r) => match(r, where)),
      create: async ({ data }: { data: Row }) => {
        const r = { id: db.epochs.length + 1, ...data };
        db.epochs.push(r);
        return r;
      },
    },
    copyOrder: {
      findMany: async ({ where }: { where: Row }) => db.orders.filter((r) => match(r, where)),
    },
    copyOrderLeg: { findMany: async () => [] },
    partnerPayout: { aggregate: async () => ({ _sum: { amountSol: null } }) },
  } as never;
  return { prisma, db };
}

async function main(): Promise<void> {
  const { prisma } = makeFake();
  const svc = new VaultService(prisma, { bulkPrices: async () => ({ M1: 2, So11111111111111111111111111111111111111112: 100 }) } as never);
  const me = { id: 7, wallet: 'cred:alice' };

  // 1. Overview: totals + pool row + exposure (10 shares/10 total = 100%).
  const ov = (await svc.portfolioOverview(me)) as Row;
  assert.equal(ov.totalValueSol, 12); // 10 shares × 1.2
  assert.equal(ov.totalDepositedSol, 10);
  assert.equal(((ov.pools as Row[]).length), 1);
  assert.equal((((ov.pools as Row[])[0] as Row).openCount as number), 1);
  assert.equal((((ov.pools as Row[])[0] as Row).sharePrice as number), 1.2);
  assert.equal((((ov.pools as Row[])[0] as Row).avgEntrySol as number), 1); // 10 SOL / 10 shares
  assert.equal((((ov.pools as Row[])[0] as Row).sharePricePct as number), 20); // 1.2/1 − 1
  const exp = (ov.exposures as Row[])[0] as Row;
  assert.equal(exp.poolId, 1);
  assert.ok((exp.mySizeSol as number) > 0); // $100 notional × 100% share
  assert.equal(((ov.pending as Row[]).length), 1);
  assert.equal(((ov.history as Row[]).length), 2); // 1 deposit + 1 withdrawal

  // 2. Cancel own QUEUED → CANCELLED; re-cancel refused; foreign refused.
  const c = await svc.cancelWithdraw(9, me);
  assert.equal(c.status, 'CANCELLED');
  await assert.rejects(() => svc.cancelWithdraw(9, me), /only QUEUED/);
  await assert.rejects(() => svc.cancelWithdraw(10, me), /not yours/);
  await assert.rejects(() => svc.cancelWithdraw(999, me), /not found/);
  // Cancelled request ignored by mine queues.
  const m = (await svc.mine(1, me)) as Row;
  assert.equal((m.queuedWithdrawals as Row[]).length, 0);

  console.log('portfolio asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
