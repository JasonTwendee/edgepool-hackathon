/**
 * Executable evidence for T2 (treasury policy: reserve/fee/lock).
 * Run: `npx tsx src/modules/vaults/assert-treasury.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService } from './vault.service.js';

type Row = Record<string, unknown>;

function makeFake() {
  const db = { vault: [] as Row[], deposit: [] as Row[], withdrawal: [] as Row[], epoch: [] as Row[] };
  let seq = 0;
  const nid = (): number => {
    seq += 1;
    return seq;
  };
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const vaultRow = (data: Row): Row => ({
    id: nid(),
    feeBps: 0,
    hwmSharePrice: 1,
    totalShares: 0,
    environment: 'SANDBOX',
    reserveBps: 0,
    withdrawFeeBps: 0,
    lockHours: 0,
    settlePeriodHours: 0,
    settleLengthMin: 0,
    treasurySol: 0,
    ...data,
  });
  return {
    vault: {
      findFirst: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      findUnique: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const r = vaultRow(data);
        db.vault.push(r);
        return r;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.vault.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
    },
    deposit: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), status: 'QUEUED', ...data };
        db.deposit.push(r);
        return r;
      },
      findMany: async ({ where }: { where: Row }) => db.deposit.filter((r) => match(r, where)),
      findFirst: async ({ where }: { where: Row }) => {
        const or = (where.OR ?? []) as Row[];
        const rows = db.deposit
          .filter((r) => r.vaultId === where.vaultId && r.status === where.status)
          .filter((r) => or.length === 0 || or.some((o) => match(r, o)));
        rows.sort(
          (a, b) => new Date(b.settledAt as string).getTime() - new Date(a.settledAt as string).getTime(),
        );
        return rows[0] ?? null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.deposit.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
      count: async ({ where }: { where: Row }) => db.deposit.filter((r) => match(r, where)).length,
    },
    withdrawal: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), status: 'QUEUED', ...data };
        db.withdrawal.push(r);
        return r;
      },
      findMany: async ({ where }: { where: Row }) => db.withdrawal.filter((r) => match(r, where)),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.withdrawal.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
      count: async ({ where }: { where: Row }) => db.withdrawal.filter((r) => match(r, where)).length,
    },
    epochCheckpoint: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), ...data, createdAt: new Date() };
        db.epoch.push(r);
        return r;
      },
      findFirst: async () => (db.epoch.length > 0 ? db.epoch[db.epoch.length - 1] : null),
    },
    vaultTrader: { findMany: async () => [], findUnique: async () => null, count: async () => 0 },
    db,
  } as never;
}

async function main(): Promise<void> {
  // 1. Policy validation + defaults in status.
  {
    const svc = new VaultService(makeFake());
    const { id } = await svc.getOrCreateVault('t2a');
    await assert.rejects(() => svc.setPolicy(id, { reserveBps: 10001 }), /reserveBps/);
    await assert.rejects(() => svc.setPolicy(id, { withdrawFeeBps: -1 }), /withdrawFeeBps/);
    await assert.rejects(() => svc.setPolicy(id, { lockHours: 9000 }), /lockHours/);
    await assert.rejects(() => svc.setPolicy(id, {}), /Nothing to update/);
    const st = await svc.status(id);
    assert.deepEqual((st as unknown as Row).policy, { reserveBps: 0, withdrawFeeBps: 0, lockHours: 0 });
    assert.equal((st as unknown as Row).treasurySol, 0);
    assert.equal((st as unknown as Row).window, null);
    const p = await svc.setPolicy(id, { withdrawFeeBps: 1000, lockHours: 24 });
    assert.deepEqual(p.policy, { reserveBps: 0, withdrawFeeBps: 1000, lockHours: 24, settlePeriodHours: 0, settleLengthMin: 0 });
  }
  // 2. Fee: 10% withdraw fee → payout reduced, treasury accrues.
  // (reserve disabled here to isolate the fee leg; reserve is tested in §4.)
  {
    const svc = new VaultService(makeFake());
    const { id } = await svc.getOrCreateVault('t2b');
    await svc.setPolicy(id, { reserveBps: 0, withdrawFeeBps: 1000 });
    await svc.deposit(id, 'dave', 10);
    await svc.settleEpoch(id, 10);
    await svc.requestWithdraw(id, 'dave', 10);
    const s = await svc.settleEpoch(id, 10);
    assert.deepEqual(s.settledWithdrawals.map((w) => w.payoutSol), [9]);
    const st = await svc.status(id);
    assert.equal((st as unknown as Row).treasurySol, 1);
  }
  // 3. Lock: fresh settled deposit blocks; aged deposit passes.
  // Sized with headroom: 10 NAV, withdraw 1 → afterNav 9 ≥ 10% floor 9.
  {
    const fake = makeFake();
    const svc = new VaultService(fake);
    const { id } = await svc.getOrCreateVault('t2c');
    await svc.setPolicy(id, { lockHours: 24 });
    await svc.deposit(id, 'erin', 10);
    await svc.settleEpoch(id, 10);
    await assert.rejects(() => svc.requestWithdraw(id, 'erin', 1), /locked until/);
    const db = (fake as unknown as { db: { deposit: Row[] } }).db;
    db.deposit[0].settledAt = new Date(Date.now() - 25 * 3600 * 1000);
    const w = await svc.requestWithdraw(id, 'erin', 1);
    assert.equal(w.status, 'QUEUED');
  }
  // 4. Reserve: 50% floor blocks deep withdrawals, allows shallow ones.
  // (Reserve is opt-in — default 0 preserves legacy full-withdraw.)
  {
    const svc = new VaultService(makeFake());
    const { id } = await svc.getOrCreateVault('t2d');
    await svc.setPolicy(id, { reserveBps: 5000 });
    await svc.deposit(id, 'fred', 10);
    await svc.settleEpoch(id, 10); // 10 shares @1, NAV 10, floor 5
    await assert.rejects(() => svc.requestWithdraw(id, 'fred', 6), /Reserve floor/);
    const w = await svc.requestWithdraw(id, 'fred', 4);
    assert.equal(w.status, 'QUEUED');
  }
  // 5. Legacy compat: defaults don't change old behavior (no fee, no lock).
  {
    const svc = new VaultService(makeFake());
    const { id } = await svc.getOrCreateVault('t2e');
    await svc.deposit(id, 'gina', 10);
    await svc.settleEpoch(id, 10);
    await svc.requestWithdraw(id, 'gina', 10);
    const s = await svc.settleEpoch(id, 10);
    assert.deepEqual(s.settledWithdrawals.map((w) => w.payoutSol), [10]);
    assert.equal((await svc.status(id)).treasurySol, 0);
  }

  console.log('treasury asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
