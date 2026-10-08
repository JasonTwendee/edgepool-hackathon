/**
 * Executable evidence for kol-earnings (report §4: profit split 80 depositors /
 * 15 partner traders / 5 Edgepool). Run: `npx tsx src/modules/vaults/assert-partner.ts`
 * (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService } from './vault.service.js';
import { base58Encode } from '../../common/auth/solana-verify.js';

type Row = Record<string, unknown>;

/** Deterministic 32-byte wallets (distinct, valid base58). */
function walletOf(n: number): string {
  return base58Encode(Buffer.alloc(32, (n + 1) % 256));
}

function makeFake() {
  const db = {
    vault: [] as Row[],
    deposit: [] as Row[],
    withdrawal: [] as Row[],
    epoch: [] as Row[],
    traders: [] as Row[],
    payouts: [] as Row[],
  };
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
    kind: 'basket',
    status: 'live',
    createdAt: new Date(),
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
    copyOrder: { findMany: async () => [] },
    epochCheckpoint: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), ...data, createdAt: new Date() };
        db.epoch.push(r);
        return r;
      },
      findFirst: async () => (db.epoch.length > 0 ? db.epoch[db.epoch.length - 1] : null),
      findMany: async () => [...db.epoch],
    },
    vaultTrader: {
      findMany: async ({ where }: { where: Row }) => db.traders.filter((r) => match(r, where)),
      findUnique: async () => null,
      count: async () => 0,
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), isActive: true, ...data };
        db.traders.push(r);
        return r;
      },
    },
    partnerPayout: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: nid(), ...data, createdAt: new Date() };
        db.payouts.push(r);
        return r;
      },
      findMany: async ({ where }: { where: Row }) => db.payouts.filter((r) => match(r, where)),
      aggregate: async ({ where }: { where: Row }) => ({
        _sum: { amountSol: db.payouts.filter((r) => match(r, where)).reduce((s, r) => s + (r.amountSol as number), 0) },
      }),
    },
    db,
  } as never;
}

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

async function feeVault(feeBps: number, kind: 'basket' | 'partner' = 'partner'): Promise<{ svc: VaultService; id: number }> {
  const fake = makeFake();
  const svc = new VaultService(fake);
  const { id } = await svc.getOrCreateVault(`${kind}-${feeBps}-${Date.now()}-${Math.random()}`);
  await (fake as unknown as { vault: { update: (a: unknown) => Promise<unknown> } }).vault.update({
    where: { id },
    data: { kind },
  } as never);
  await svc.setPolicy(id, { feeBps });
  await svc.deposit(id, 'carol', 10);
  await svc.settleEpoch(id, 10); // price 1, 10 shares
  return { svc, id };
}

async function main(): Promise<void> {
  // 1. Report §4 example: NAV 10→11, fee 20% → fee 0.2, partner 0.15, edgepool 0.05.
  {
    const { svc, id } = await feeVault(2000);
    const t1 = walletOf(1);
    await svc.assignTrader(id, t1, 10000);
    const s = await svc.settleEpoch(id, 11);
    assert.equal(s.feeSol, 0.2);
    assert.equal(s.partnerPayouts.length, 1);
    assert.ok(close(s.partnerPayouts[0].amountSol, 0.15));
    assert.ok(close(s.edgepoolSol, 0.05));
    const st = await svc.status(id);
    assert.ok(close(st.treasurySol, 0.05));
    assert.ok(close(st.partnerAccruedSol, 0.15));
    // Conservation: payouts + edgepool + post-fee nav == input NAV.
    const parts = s.partnerPayouts.reduce((x, p) => x + p.amountSol, 0);
    assert.ok(close(parts + s.edgepoolSol + s.navSol, 11));
    // Earnings ledger readable + filterable.
    const e = await svc.earnings(id);
    assert.ok(close(e.totalSol, 0.15));
    const one = await svc.earnings(id, t1);
    assert.ok(close(one.totalSol, 0.15));
    assert.ok(close((await svc.earnings(id, walletOf(99))).totalSol, 0));
  }

  // 2. Pro-rata: weights 7500/2500 on fee 0.2 → 0.1125 / 0.0375, edgepool 0.05.
  {
    const { svc, id } = await feeVault(2000);
    const ta = walletOf(10);
    const tb = walletOf(11);
    await svc.assignTrader(id, ta, 7500);
    await svc.assignTrader(id, tb, 2500);
    const s = await svc.settleEpoch(id, 11);
    assert.equal(s.partnerPayouts.length, 2);
    const got = Object.fromEntries(s.partnerPayouts.map((p) => [p.trader, p.amountSol]));
    assert.ok(close(got[ta], 0.1125), `A=${got[ta]}`);
    assert.ok(close(got[tb], 0.0375), `B=${got[tb]}`);
    assert.ok(close(s.edgepoolSol, 0.05));
  }

  // 3. Odd weights conserve exactly: dust goes to treasury, never created/lost.
  {
    const { svc, id } = await feeVault(2000);
    await svc.assignTrader(id, walletOf(20), 3333);
    await svc.assignTrader(id, walletOf(21), 3333);
    await svc.assignTrader(id, walletOf(22), 3334);
    const s = await svc.settleEpoch(id, 11);
    const parts = s.partnerPayouts.reduce((x, p) => x + p.amountSol, 0);
    assert.ok(close(parts + s.edgepoolSol, s.feeSol));
    assert.ok(close(parts + s.edgepoolSol + s.navSol, 11));
  }

  // 4. No active traders → whole fee accrues to treasury, no rows.
  {
    const { svc, id } = await feeVault(2000);
    const s = await svc.settleEpoch(id, 11);
    assert.equal(s.feeSol, 0.2);
    assert.deepEqual(s.partnerPayouts, []);
    assert.ok(close(s.edgepoolSol, 0.2));
    assert.ok(close((await svc.status(id)).treasurySol, 0.2));
    assert.ok(close((await svc.earnings(id)).totalSol, 0));
  }

  // 5. feeBps 0 → no fee, no rows, no treasury movement.
  {
    const { svc, id } = await feeVault(0);
    await svc.assignTrader(id, walletOf(30), 10000);
    const s = await svc.settleEpoch(id, 11);
    assert.equal(s.feeSol, 0);
    assert.deepEqual(s.partnerPayouts, []);
    assert.equal(s.edgepoolSol, 0);
  }

  // 6. Zero-weight / inactive traders are skipped.
  {
    const { svc, id } = await feeVault(2000);
    await svc.assignTrader(id, walletOf(31), 0);
    const s = await svc.settleEpoch(id, 11);
    assert.deepEqual(s.partnerPayouts, []);
    assert.ok(close(s.edgepoolSol, 0.2));
  }

  // 7. Fix #5: basket pools split 50/50 (fee 0.2 → partner 0.1, edgepool 0.1).
  {
    const { svc, id } = await feeVault(2000, 'basket');
    const t1 = walletOf(41);
    await svc.assignTrader(id, t1, 10000);
    const s = await svc.settleEpoch(id, 11);
    assert.equal(s.feeSol, 0.2);
    assert.equal(s.partnerPayouts.length, 1);
    assert.ok(close(s.partnerPayouts[0].amountSol, 0.1), `basket partner=${s.partnerPayouts[0]?.amountSol}`);
    assert.ok(close(s.edgepoolSol, 0.1), `basket edgepool=${s.edgepoolSol}`);
    const parts = s.partnerPayouts.reduce((x, p) => x + p.amountSol, 0);
    assert.ok(close(parts + s.edgepoolSol, s.feeSol));
    assert.ok(close(parts + s.edgepoolSol + s.navSol, 11));
  }

  console.log('partner asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
