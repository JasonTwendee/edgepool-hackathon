/**
 * Executable evidence for pool app P4 (trader portal backend).
 * Run: `npx tsx src/modules/partner/assert-partner.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PartnerService } from './partner.service.js';
import { payoutChallengeMessage } from './partner.service.js';
import { base58Encode } from '../../common/auth/solana-verify.js';

const W = (n: number): string => base58Encode(Buffer.alloc(32, n & 0xff));

/** In-test ed25519 fixture: fresh keypair + base58 pubkey + message signer. */
function fixtureKey(): { pubkey: string; signMsg: (message: string) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const pubkey = base58Encode(Buffer.from(raw));
  return {
    pubkey,
    signMsg: (message: string) => base58Encode(sign(null, Buffer.from(message, 'utf8'), privateKey)),
  };
}

type Row = Record<string, unknown>;

function makeFake() {
  const db = {
    user: [
      { id: 7, wallet: 'cred:kol', username: 'kol', role: 'KOL', payoutWallet: null, payoutWalletVerifiedAt: null },
      { id: 1, wallet: 'adminw', username: null, role: 'ADMIN', payoutWallet: null, payoutWalletVerifiedAt: null },
    ] as Row[],
    challenges: [] as Row[],
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
      findFirst: async ({ where }: { where: Row }) => db.apps.filter((r) => match(r, where)).sort((a, b) => (b.id as number) - (a.id as number))[0] ?? null,
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
    payoutWalletChallenge: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: db.challenges.length + 1, consumedAt: null, createdAt: new Date(), ...data };
        db.challenges.push(r);
        return r;
      },
      findFirst: async ({ where }: { where: Row }) => {
        const rows = db.challenges.filter((r) => match(r, where)).sort((a, b) => (b.id as number) - (a.id as number));
        return rows[0] ?? null;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.challenges.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
    },
  } as never;
  const audit = { record: async () => ({ id: 1 }) } as never;
  const vaults = {
    status: async () => ({ window: null, totalShares: 10 }),
    assignTrader: async (vaultId: number, wallet: string) => ({ vaultId, wallet, isActive: true }),
    removeTrader: async (vaultId: number, wallet: string) => ({ vaultId, wallet, isActive: false }),
  } as never;
  const prices = { bulkPrices: async () => ({}) } as never;
  return { prisma, vaults, prices, audit, db };
}

const KOL = { id: 7, wallet: 'cred:kol', role: 'KOL' };
const ADMIN = { id: 1, wallet: 'adminw', role: 'ADMIN' };

async function main(): Promise<void> {
  const { prisma, vaults, prices, audit, db } = makeFake();
  const svc = new PartnerService(prisma, vaults, prices, audit);

  // 1. Public apply → pending (bad wallet rejected).
  const app = (await svc.apply({ fomoHandle: '@newtrader', wallet: W(11), contact: 't@x.io' })) as Row;
  assert.equal(app.status, 'pending');
  await assert.rejects(() => svc.apply({ fomoHandle: 'ab', wallet: 'bad', contact: 't@x.io' }), /Invalid Solana/);
  // 1b. Public status check: latest row wins, unknown wallet → null.
  const ast = (await svc.applyStatus(W(11))) as Row;
  assert.equal(ast.status, 'pending');
  const none = (await svc.applyStatus(W(12))) as Row;
  assert.equal(none.status, null);
  const blank = (await svc.applyStatus('')) as Row;
  assert.equal(blank.status, null);

  // 2. me(): pools + fees (claimable 0.15, paid 0) + basket status.
  const me = (await svc.me(KOL)) as Row;
  assert.equal(((me.pools as Row[]).length), 1);
  assert.equal(((me.fees as Row).claimableSol as number), 0.15);
  assert.equal(((me.fees as Row).paidSol as number), 0);
  assert.equal((((me.basket as Row[])[0] as Row).inBasket as boolean), true);

  // 3. Claim requires a VERIFIED payout wallet (fix 7: signature challenge).
  await assert.rejects(() => svc.claim(KOL), /payout wallet/);
  await assert.rejects(() => svc.issuePayoutChallenge(KOL, 'bad'), /Invalid Solana/);
  // No challenge → set refused (attacker with no key can't proceed).
  await assert.rejects(() => svc.setPayoutWallet(KOL, W(22), 'anysignature'), /Challenge expired or missing/);
  const key = fixtureKey();
  const ch = (await svc.issuePayoutChallenge(KOL, key.pubkey)) as { wallet: string; nonce: string; message: string; expiresAt: string };
  assert.equal(ch.wallet, key.pubkey);
  assert.equal(ch.message, payoutChallengeMessage(key.pubkey, KOL.wallet, ch.nonce, new Date(ch.expiresAt)));
  // Wrong-key signature refused.
  const other = fixtureKey();
  await assert.rejects(() => svc.setPayoutWallet(KOL, key.pubkey, other.signMsg(ch.message)), /Invalid signature/);
  // Expired challenge refused.
  (db.challenges[db.challenges.length - 1] as Row).expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(() => svc.setPayoutWallet(KOL, key.pubkey, key.signMsg(ch.message)), /expired or missing/);
  // Fresh challenge + owner signature → verified; claim flows.
  const ch2 = (await svc.issuePayoutChallenge(KOL, key.pubkey)) as { message: string };
  await svc.setPayoutWallet(KOL, key.pubkey, key.signMsg(ch2.message));
  const meAfter = (await svc.me(KOL)) as Row;
  assert.equal(meAfter.payoutWalletVerified, true);
  const claimed = await svc.claim(KOL);
  assert.equal(claimed.claimedSol, 0.15);
  assert.equal(claimed.rows, 1);
  const fees2 = (await svc.fees(KOL)) as Row;
  assert.equal(fees2.claimableSol, 0);
  assert.equal(fees2.paidSol, 0.15);

  // 4. Settings are ADMIN-only (pool ops live in /terminal, not the KOL portal).
  // KOL direct calls are refused even for their own pool; ADMIN passes.
  await assert.rejects(() => svc.updateSettings(1, KOL, { name: 'KOL rename' }), /ADMIN only/);
  const st = (await svc.updateSettings(1, ADMIN, { name: 'Renamed Pool', status: 'paused', maxSlots: 50 })) as Row;
  assert.equal(st.name, 'Renamed Pool');
  assert.equal(st.status, 'paused');
  await assert.rejects(() => svc.updateSettings(1, ADMIN, { rulesJson: { nope: 1 } }), /Unknown rule/);
  const ok = (await svc.updateSettings(1, ADMIN, { rulesJson: { traderCapPctNav: 2 }, maxTraders: 4 })) as Row;
  assert.equal(ok.maxTraders, 4);
  await assert.rejects(() => svc.updateSettings(1, ADMIN, { maxSlots: 0 }), /1\.\.1000/);
  await assert.rejects(() => svc.pauseTrader(1, KOL, 'W1', false), /ADMIN only/);

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
