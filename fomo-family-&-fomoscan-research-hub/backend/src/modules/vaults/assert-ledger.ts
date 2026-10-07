/**
 * Executable evidence for the fund-flow ledger (1 bot = 1 vault traceability).
 * Run: `npx tsx src/modules/vaults/assert-ledger.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService } from './vault.service.js';

type Row = Record<string, unknown>;

const WSOL = 'So11111111111111111111111111111111111111112';

function makeFake() {
  const now = Date.now();
  const db = {
    vaults: [
      { id: 1, name: 'v', kind: 'basket', status: 'live', listing: 'public', feeBps: 0, hwmSharePrice: 1, totalShares: 15, maxSlots: 100, maxTraders: 5, environment: 'SANDBOX', createdAt: new Date(now - 30 * 86400000) },
    ] as Row[],
    epochs: [
      { id: 1, vaultId: 1, navSol: 15, sharePrice: 1, sharesOutstanding: 15, createdAt: new Date(now - 86400000) },
    ] as Row[],
    deposits: [
      { id: 1, vaultId: 1, depositor: 'alice', userId: 7, amountSol: 10, status: 'SETTLED', sharesMinted: 10, sharePrice: 1, createdAt: new Date(now - 80000), settledAt: new Date(now - 80000) },
      { id: 2, vaultId: 1, depositor: 'bob', userId: null, amountSol: 5, status: 'SETTLED', sharesMinted: 5, sharePrice: 1, createdAt: new Date(now - 70000), settledAt: new Date(now - 70000) },
    ] as Row[],
    withdrawals: [
      { id: 3, vaultId: 1, depositor: 'bob', userId: null, sharesRequested: 2, status: 'SETTLED', sharePrice: 1, payoutSol: 2, createdAt: new Date(now - 60000), settledAt: new Date(now - 60000) },
    ] as Row[],
    orders: [
      { id: 1, vaultId: 1, status: 'CONFIRMED', symbol: 'T1', masterHandle: 't1', masterWallet: 'W1', tokenMint: 'M1', amountUsd: 100, entryPriceUsd: 10, closeReason: null, closedAt: null, realizedPnlUsd: 0, createdAt: new Date(now - 3600000) },
      { id: 2, vaultId: 1, status: 'CONFIRMED', symbol: 'T2', masterHandle: 't2', masterWallet: 'W2', tokenMint: 'M2', amountUsd: 50, entryPriceUsd: 5, closeReason: 'TP1_HIT', closedAt: new Date(now - 1800000), realizedPnlUsd: 5, createdAt: new Date(now - 7200000) },
    ] as Row[],
  };
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'OR' && Array.isArray(v)) return (v as Row[]).some((o) => match(r, o));
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const prisma = {
    vault: {
      findUnique: async ({ where }: { where: Row }) => db.vaults.find((r) => match(r, where)) ?? null,
    },
    epochCheckpoint: {
      findMany: async ({ where }: { where: Row }) => db.epochs.filter((r) => match(r, where)),
      findFirst: async ({ where }: { where: Row }) => {
        const rows = db.epochs.filter((r) => match(r, where));
        return rows[rows.length - 1] ?? null;
      },
    },
    deposit: {
      findMany: async ({ where }: { where: Row }) => db.deposits.filter((r) => match(r, where)),
    },
    withdrawal: {
      findMany: async ({ where }: { where: Row }) => db.withdrawals.filter((r) => match(r, where)),
    },
    copyOrder: {
      // Mirror orderBy id desc like the real query.
      findMany: async ({ where }: { where: Row }) =>
        db.orders.filter((r) => match(r, where)).sort((a, b) => (b.id as number) - (a.id as number)),
    },
  } as never;
  const prices = {
    bulkPrices: async (mints: string[]) => Object.fromEntries(mints.map((m) => [m, m === WSOL ? 100 : 12])),
  } as never;
  return { prisma, prices, db };
}

async function main(): Promise<void> {
  // 1. Statement reconciles the vault cash.
  {
    const { prisma, prices } = makeFake();
    const svc = new VaultService(prisma, prices);
    const res = (await svc.ledger(1)) as Row;
    const st = res.statement as Row;
    assert.equal(st.settledDepositsSol, 15);
    assert.equal(st.settledWithdrawalsSol, 2);
    assert.equal(st.openAllocatedUsd, 100);
    assert.equal(st.realizedUsd, 5);
    // Open: 10 tokens @10 → live 12 = 120 value, +20 unrealized.
    assert.equal(st.unrealizedUsd, 20);
    assert.equal(st.navSol, 15);
    assert.equal(st.sharePrice, 1);
    const orders = res.orders as Row[];
    assert.equal(orders.length, 2);
    assert.equal(orders[0].id, 2); // desc
    assert.equal(orders[1].allocatedSol, 1); // $100 @ $100/SOL
    assert.equal(orders[1].liveValueUsd, 120);
    assert.equal(orders[0].realizedUsd, 5);
  }
  // 2. Paywalled when anonymous, open with a queued ≥0.5 deposit.
  {
    const { prisma, prices, db } = makeFake();
    const svc = new VaultService(prisma, prices);
    const anon = (await svc.ledger(1)) as Row;
    assert.equal(anon.masked, true);
    assert.equal(((anon.orders as Row[])[0] as Row).token, '$••••');
    db.deposits.push({ id: 9, vaultId: 1, depositor: 'carol', userId: 9, amountSol: 1, status: 'QUEUED', sharesMinted: 0, sharePrice: 1, createdAt: new Date() });
    const authed = (await svc.ledger(1, { id: 9, wallet: 'carol' })) as Row;
    assert.equal(authed.masked, false);
    assert.equal(((authed.orders as Row[])[0] as Row).token, 'T2');
  }

  console.log('ledger asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
