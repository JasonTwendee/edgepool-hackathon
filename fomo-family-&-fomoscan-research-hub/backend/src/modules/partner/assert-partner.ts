/**
 * Executable evidence for pool app P4 (trader portal backend).
 * Run: `npx tsx src/modules/partner/assert-partner.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { PartnerService } from './partner.service.js';
import { base58Encode } from '../../common/auth/solana-verify.js';

const W = (n: number): string => base58Encode(Buffer.alloc(32, n & 0xff));

type Row = Record<string, unknown>;

function makeFake() {
  const db = {
    user: [
      { id: 7, wallet: 'cred:kol', username: 'kol', role: 'KOL', payoutWallet: null },
      { id: 1, wallet: 'adminw', username: null, role: 'ADMIN', payoutWallet: null },
    ] as Row[],
    vault: [
      { id: 1, name: 'p1', kind: 'basket', status: 'live', listing: 'public', feeBps: 2000, hwmSharePrice: 1, totalShares: 10, maxSlots: 100, maxTraders: 5, ownerUserId: 7, environment: 'SANDBOX', createdAt: new Date('2026-01-01') },
      { id: 2, name: 'other', kind: 'partner', status: 'live', listing: 'public', feeBps: 0, hwmSharePrice: 1, totalShares: 0, maxSlots: 10, maxTraders: 3, ownerUserId: null, environment: 'SANDBOX', createdAt: new Date('2026-01-01') },
    ] as Row[],
    traders: [{ id: 1, vaultId: 1, wallet: 'W1', weightBps: 5000, isActive: true }] as Row[],
    orders: [] as Row[],
    payouts: [
      { id: 1, vaultId: 1, trader: 'W1', amountSol: 0.15, epochId: 1, kind: 'PERF_FEE', status: 'ACCRUED', createdAt: new Date('2026-03-01') },
    ] as Row[],
    apps: [] as Row[],
    requests: [] as Row[],
    deposits: [] as Row[],
  };
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (k === 'OR' && Array.isArray(v)) return (v as Row[]).some((o) => match(r, o));
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Row }) => db.user.find((r) => match(r, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.user.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
    },
    vault: {
      findMany: async ({ where }: { where?: Row } = {}) => (where ? db.vault.filter((r) => match(r, where)) : [...db.vault]),
      findFirst: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      findUnique: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.vault.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
    },
    vaultTrader: {
      findMany: async ({ where }: { where: Row }) => db.traders.filter((r) => match(r, where)),
    },
    copyOrder: {
      findMany: async ({ where }: { where: Row }) => db.orders.filter((r) => match(r, where)),
    },
    trackedWallet: {
      findMany: async () => [{ address: 'W1', handle: 't1', fomoRank: 3 }],
    },
    partnerPayout: {
      findMany: async ({ where }: { where: Row }) => db.payouts.filter((r) => match(r, where)),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let n = 0;
        for (const r of db.payouts.filter((x) => match(x, where))) {
          Object.assign(r, data);
          n++;
        }
        return { count: n };
      },
    },
    partnerApplication: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: db.apps.length + 1, ...data };
        db.apps.push(r);
        return r;
      },
      findMany: async () => [...db.apps],
      findUnique: async ({ where }: { where: Row }) => db.apps.find((r) => match(r, where)) ?? null,
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.apps.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
    },
    traderRequest: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: db.requests.length + 1, ...data };
        db.requests.push(r);
        return r;
      },
      findMany: async ({ where }: { where: Row }) => db.requests.filter((r) => match(r, where)),
    },
    deposit: {
      findMany: async () => [],
    },
    epochCheckpoint: {
      findFirst: async () => null,
    },
  } as never;
  const vaults = {
    status: async () => ({ window: null, totalShares: 10 }),
    assignTrader: async (vaultId: number, wallet: string) => ({ vaultId, wallet, isActive: true }),
    removeTrader: async (vaultId: number, wallet: string) => ({ vaultId, wallet, isActive: false }),
  } as never;
  const prices = { bulkPrices: async () => ({}) } as never;
  return { prisma, vaults, prices, db };
}

const KOL = { id: 7, wallet: 'cred:kol', role: 'KOL' };
const ADMIN = { id: 1, wallet: 'adminw', role: 'ADMIN' };

async function main(): Promise<void> {
  const { prisma, vaults, prices } = makeFake();
  const svc = new PartnerService(prisma, vaults, prices);

  // 1. Public apply → pending (bad wallet rejected).
  const app = (await svc.apply({ fomoHandle: '@newtrader', wallet: W(11), contact: 't@x.io' })) as Row;
  assert.equal(app.status, 'pending');
  await assert.rejects(() => svc.apply({ fomoHandle: 'ab', wallet: 'bad', contact: 't@x.io' }), /Invalid Solana/);

  // 2. me(): pools + fees (claimable 0.15, paid 0) + basket status.
  const me = (await svc.me(KOL)) as Row;
  assert.equal(((me.pools as Row[]).length), 1);
  assert.equal(((me.fees as Row).claimableSol as number), 0.15);
  assert.equal(((me.fees as Row).paidSol as number), 0);
  assert.equal((((me.basket as Row[])[0] as Row).inBasket as boolean), true);

  // 3. Claim requires payout wallet; then ACCRUED→PAID.
  await assert.rejects(() => svc.claim(KOL), /payout wallet/);
  await svc.setPayoutWallet(KOL, W(22));
  await assert.rejects(() => svc.setPayoutWallet(KOL, 'bad'), /Invalid Solana/);
  const claimed = await svc.claim(KOL);
  assert.equal(claimed.claimedSol, 0.15);
  assert.equal(claimed.rows, 1);
  const fees2 = (await svc.fees(KOL)) as Row;
  assert.equal(fees2.claimableSol, 0);
  assert.equal(fees2.paidSol, 0.15);

  // 4. Settings: owner OK (name + pause + bad key rejected); foreign vault refused.
  const st = (await svc.updateSettings(1, KOL, { name: 'Renamed Pool', status: 'paused', maxSlots: 50 })) as Row;
  assert.equal(st.name, 'Renamed Pool');
  assert.equal(st.status, 'paused');
  await assert.rejects(() => svc.updateSettings(1, KOL, { rulesJson: { nope: 1 } }), /Unknown rule/);
  await assert.rejects(() => svc.updateSettings(2, KOL, { name: 'Hijack' }), /not assigned/);
  const ok = (await svc.updateSettings(1, KOL, { rulesJson: { traderCapPctNav: 2 }, maxTraders: 4 })) as Row;
  assert.equal(ok.maxTraders, 4);
  await assert.rejects(() => svc.updateSettings(1, KOL, { maxSlots: 0 }), /1\.\.1000/);

  // 5. Traders table + request trader + signals + payouts.
  const trs = (await svc.poolTraders(1, KOL)) as Row[];
  assert.equal(trs.length, 1);
  assert.equal((trs[0] as Row).feeSol, 0.15);
  const rq = (await svc.requestTrader(1, KOL, { fomoHandle: '@candidate' })) as Row;
  assert.equal(rq.status, 'pending');
  assert.equal(((await svc.signals(KOL)) as Row[]).length, 0);
  assert.equal(((await svc.payouts(KOL)) as Row[]).length, 1);

  // 6. ADMIN review: reject + approve w/ owner assignment.
  await assert.rejects(() => svc.applications(KOL), /ADMIN only/);
  assert.equal(((await svc.applications(ADMIN)) as Row[]).length, 1);
  await svc.reviewApplication(1, ADMIN, { decision: 'approved', vaultId: 2, userId: 7 });
  const me2 = (await svc.me(KOL)) as Row;
  assert.equal(((me2.pools as Row[]).length), 2);

  console.log('partner asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
