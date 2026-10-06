/**
 * Executable evidence for Phase C (MoneyFi vault accounting).
 * Run: `npx tsx src/modules/vaults/assert-vault.ts` (mocked DB, no network).
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
      if (k === 'OR' && Array.isArray(v)) return (v as Row[]).some((o) => match(r, o));
      if (v !== null && typeof v === 'object' && ('gte' in (v as object) || 'not' in (v as object))) return true;
      return r[k] === v;
    });
  return {
    vault: {
      findFirst: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      findUnique: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), feeBps: 0, hwmSharePrice: 1, totalShares: 0, ...data };
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
    partnerPayout: {
      create: async ({ data }: { data: Row }) => ({ id: nid(), ...data, createdAt: new Date() }),
      findMany: async () => [],
      aggregate: async () => ({ _sum: { amountSol: null } }),
    },
  } as never;
}

async function main(): Promise<void> {
  const svc = new VaultService(makeFake());
  const { id } = await svc.getOrCreateVault('paper');
  assert.equal(id, 1);

  // 1. First deposit 10 SOL, settle at NAV 10 → price 1, 10 shares.
  await svc.deposit(id, 'alice', 10);
  const s1 = await svc.settleEpoch(id, 10);
  assert.equal(s1.sharePrice, 1);
  assert.deepEqual(s1.settledDeposits.map((d) => d.shares), [10]);

  // 2. NAV rises to 12 (profit before newcomer). Bob deposits 6 → vault holds
  // 18 → price (18-6)/10 = 1.2, mints 5 (no retro profit, no self-inflation).
  await svc.deposit(id, 'bob', 6);
  const s2 = await svc.settleEpoch(id, 18);
  assert.equal(s2.sharePrice, 1.2);
  assert.deepEqual(s2.settledDeposits.map((d) => d.shares), [5]);
  // Alice's 10 shares are now worth 12 (profit kept); Bob has no retro profit.
  assert.equal(await svc.depositorShares(id, 'alice'), 10);
  assert.equal(await svc.depositorShares(id, 'bob'), 5);

  // 3. Alice withdraws 4 shares at 1.2 → 4.8 SOL, 6 shares left.
  await svc.requestWithdraw(id, 'alice', 4);
  const s3 = await svc.settleEpoch(id, 18);
  assert.deepEqual(s3.settledWithdrawals.map((w) => w.payoutSol), [4.8]);
  assert.equal(await svc.depositorShares(id, 'alice'), 6);

  // 4. Over-withdraw rejected.
  await assert.rejects(() => svc.requestWithdraw(id, 'bob', 99), /Insufficient/);
  await assert.rejects(() => svc.deposit(id, 'x', -1), /positive/);

  // 5. Fee: enable 20%, NAV 10→13.2 on 11 shares → profit 1.2 → fee 0.24.
  const svc2 = new VaultService(makeFake());
  const v2 = await svc2.getOrCreateVault('fee');
  await (svc2 as unknown as { prisma: { vault: { update: (a: unknown) => Promise<unknown> } } }).prisma.vault.update({
    where: { id: v2.id },
    data: { feeBps: 2000 },
  } as never);
  await svc2.deposit(v2.id, 'carol', 10);
  await svc2.settleEpoch(v2.id, 10);
  const f1 = await svc2.settleEpoch(v2.id, 13.2);
  assert.ok(Math.abs(f1.feeSol - 0.64) < 1e-9, `fee=${f1.feeSol}`);
  // Second settle at post-fee NAV (12.56) → no new profit → no fee.
  const f2 = await svc2.settleEpoch(v2.id, 12.56);
  assert.equal(f2.feeSol, 0);

  // 6. mine(): investor view matched by userId (alice row carries userId 7).
  const svc3 = new VaultService(makeFake());
  const v3 = await svc3.getOrCreateVault('mine');
  await svc3.deposit(v3.id, 'alice', 10, 7);
  await svc3.deposit(v3.id, 'bob', 4);
  await svc3.settleEpoch(v3.id, 14);
  const m = await svc3.mine(v3.id, { id: 7, wallet: 'cred:alice' });
  assert.equal(m.shares, 10);
  assert.equal(m.depositedSol, 10);
  assert.equal(m.queuedDeposits.length, 0);
  // Stranger sees zero.
  const stranger = await svc3.mine(v3.id, { id: 99, wallet: 'cred:ghost' });
  assert.equal(stranger.shares, 0);
  assert.equal(stranger.depositedSol, 0);

  // 7. Prod guard: test-like pool names are refused in production, allowed elsewhere.
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const svc4 = new VaultService(makeFake());
  await assert.rejects(() => svc4.createVault('edgepool-smoke-1'), /test-like pool name/);
  await assert.rejects(() => svc4.createVault('fee-e2e'), /test-like pool name/);
  await assert.rejects(() => svc4.createVault('prod-x'), /test-like pool name/);
  // demo- stays allowed in prod: explicit ADMIN tool, cleaned by demo reset.
  const demo = (await svc4.createVault('demo-fund-x')) as Row;
  assert.equal(demo.name, 'demo-fund-x');
  const legit = (await svc4.createVault('Kestrel Collective 2')) as Row;
  assert.equal(legit.name, 'Kestrel Collective 2');
  process.env.NODE_ENV = prevEnv;
  const svc5 = new VaultService(makeFake());
  const allowed = (await svc5.createVault('edgepool-smoke-1')) as Row;
  assert.equal(allowed.name, 'edgepool-smoke-1');

  console.log('vault asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
