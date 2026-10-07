/**
 * Executable evidence for withdrawal windows (settle schedule gate).
 * Run: `npx tsx src/modules/vaults/assert-windows.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService, windowState } from './vault.service.js';

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
  return {
    vault: {
      findFirst: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      findUnique: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const r = {
          id: nid(), name: 'w', feeBps: 0, hwmSharePrice: 1, totalShares: 0,
          environment: 'SANDBOX', reserveBps: 0, withdrawFeeBps: 0, lockHours: 0,
          settlePeriodHours: 0, settleLengthMin: 0, treasurySol: 0,
          createdAt: new Date(), ...data,
        };
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
      findFirst: async () => null,
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
      findMany: async () => [...db.epoch],
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
  const now = Date.now();

  // 1. windowState pure math.
  assert.equal(windowState(new Date(now), 0, 0, now), null);
  assert.equal(windowState(new Date(now), 24, 0, now), null);
  const open = windowState(new Date(now), 24, 60, now);
  assert.ok(open && open.open === true && open.periodHours === 24 && open.lengthMin === 60);
  assert.ok(Date.parse((open as { nextOpensAt: string }).nextOpensAt) - now > 23 * 3600 * 1000);
  const twoHoursAgo = new Date(now - 2 * 3600 * 1000);
  const closed = windowState(twoHoursAgo, 24, 60, now);
  assert.ok(closed && closed.open === false);
  assert.equal(Date.parse((closed as { nextOpensAt: string }).nextOpensAt), twoHoursAgo.getTime() + 24 * 3600 * 1000);
  // Boundary: pos == length → closed.
  const atEdge = windowState(new Date(now - 3600 * 1000), 24, 60, now);
  assert.equal(atEdge?.open, false);

  // 2. Policy validation: half-configurations rejected.
  {
    const svc = new VaultService(makeFake());
    const { id } = await svc.getOrCreateVault('win-a');
    await assert.rejects(() => svc.setPolicy(id, { settleLengthMin: 30 }), /settlePeriodHours/);
    await assert.rejects(() => svc.setPolicy(id, { settlePeriodHours: 24 }), /settleLengthMin/);
    await assert.rejects(() => svc.setPolicy(id, { settlePeriodHours: 9000 }), /settlePeriodHours/);
    await assert.rejects(() => svc.setPolicy(id, { settlePeriodHours: 24, settleLengthMin: 2000 }), /settleLengthMin/);
    const p = await svc.setPolicy(id, { settlePeriodHours: 24, settleLengthMin: 60 });
    assert.equal(p.policy.settlePeriodHours, 24);
    assert.equal(p.policy.settleLengthMin, 60);
  }
  // 3. Windows OFF → settle legacy behavior.
  {
    const svc = new VaultService(makeFake());
    const { id } = await svc.getOrCreateVault('win-b');
    await svc.deposit(id, 'amy', 10);
    const s = await svc.settleEpoch(id, 10);
    assert.equal(s.sharePrice, 1);
    const st = await svc.status(id);
    assert.equal((st as unknown as Row).window, null);
  }
  // 4. Window OPEN (fresh vault, 24h/60m) → settle works + status shows window.
  {
    const svc = new VaultService(makeFake());
    const { id } = await svc.getOrCreateVault('win-c');
    await svc.setPolicy(id, { settlePeriodHours: 24, settleLengthMin: 60 });
    await svc.deposit(id, 'bob', 5);
    const s = await svc.settleEpoch(id, 5);
    assert.equal(s.sharePrice, 1);
    const st = await svc.status(id);
    const win = (st as unknown as Row).window as Row;
    assert.equal(win.open, true);
  }
  // 5. Window CLOSED → settle 400 with next time, but requests still queue.
  {
    const fake = makeFake();
    const svc = new VaultService(fake);
    const created = (await (fake as unknown as { vault: { create: (a: unknown) => Promise<Row> } }).vault.create({
      data: { name: 'win-d', createdAt: new Date(now - 2 * 3600 * 1000) },
    })) as Row;
    const id = created.id as number;
    await svc.setPolicy(id, { settlePeriodHours: 24, settleLengthMin: 60 });
    await svc.deposit(id, 'cara', 5); // queues fine outside window
    await assert.rejects(() => svc.settleEpoch(id, 5), /next opens at/);
    const st = await svc.status(id);
    assert.equal(((st as unknown as Row).window as Row).open, false);
  }

  console.log('windows asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
