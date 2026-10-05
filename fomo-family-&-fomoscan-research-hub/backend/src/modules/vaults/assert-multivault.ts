/**
 * Executable evidence for P3 (multi-vault + traders + bots + environment).
 * Run: `npx tsx src/modules/vaults/assert-multivault.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService, MAX_VAULT_TRADERS } from './vault.service.js';
import { BotsService } from '../bots/bots.service.js';
import { base58Encode } from '../../common/auth/solana-verify.js';

type Row = Record<string, unknown>;

function walletOf(n: number): string {
  // Deterministic 32-byte wallets (distinct, valid base58).
  return base58Encode(Buffer.alloc(32, (n + 1) % 256));
}

function makeFake() {
  const db = { vault: [] as Row[], trader: [] as Row[], deposit: [] as Row[], bot: [] as Row[] };
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
  const vault = {
    findFirst: async () => null,
    findUnique: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
    findMany: async () => [...db.vault],
    create: async ({ data }: { data: Row }) => {
      if (db.vault.some((r) => r.name === data.name)) throw new Error('unique');
      const r = { id: nid(), feeBps: 0, hwmSharePrice: 1, totalShares: 0, environment: 'SANDBOX', ...data };
      db.vault.push(r);
      return r;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = db.vault.find((x) => match(x, where)) as Row;
      Object.assign(r, data);
      return r;
    },
  };
  const vaultTrader = {
    findUnique: async ({ where }: { where: { vaultId_wallet: Row } }) => {
      const w = where.vaultId_wallet;
      return db.trader.find((r) => r.vaultId === w.vaultId && r.wallet === w.wallet) ?? null;
    },
    findMany: async ({ where }: { where: Row }) => db.trader.filter((r) => match(r, where)),
    create: async ({ data }: { data: Row }) => {
      const r = { id: nid(), weightBps: 0, isActive: true, ...data };
      db.trader.push(r);
      return r;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = db.trader.find((x) => match(x, where)) as Row;
      Object.assign(r, data);
      return r;
    },
    count: async ({ where }: { where: Row }) => db.trader.filter((r) => match(r, where)).length,
  };
  const deposit = {
    create: async ({ data }: { data: Row }) => {
      const r = { id: nid(), status: 'QUEUED', ...data };
      db.deposit.push(r);
      return r;
    },
    findMany: async () => [],
    count: async () => 0,
  };
  const bot = {
    findMany: async () => [...db.bot],
    findUnique: async ({ where }: { where: Row }) => db.bot.find((r) => match(r, where)) ?? null,
    create: async ({ data }: { data: Row }) => {
      if (db.bot.some((r) => r.name === (data as Row).name)) throw new Error('unique');
      const r = { id: nid(), ...data };
      db.bot.push(r);
      return r;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = db.bot.find((x) => match(x, where)) as Row;
      Object.assign(r, data);
      return r;
    },
  };
  return { vault, vaultTrader, deposit, bot, db } as never;
}

async function main(): Promise<void> {
  const fake = makeFake();
  const svc = new VaultService(fake);
  assert.equal(MAX_VAULT_TRADERS, 5);

  // 1. Create SANDBOX vault; PRODUCTION refused explicitly.
  const v1 = (await svc.createVault('alpha')) as Row;
  assert.equal(v1.environment, 'sandbox');
  await assert.rejects(() => svc.createVault('prod', 'PRODUCTION'), /not enabled/);
  await assert.rejects(() => svc.createVault('x'), /required/);

  // 2. Second vault lists separately with its own trader set.
  const v2 = (await svc.createVault('beta')) as Row;
  const list = (await svc.listVaults()) as { id: number; name: string; environment: string; traders: Row[] }[];
  assert.equal(list.length, 2);
  assert.ok(list.every((v) => v.environment === 'sandbox'));
  assert.deepEqual(list.map((v) => v.traders), [[], []]);

  // 3. Assign 5 traders OK; 6th rejected by cap.
  const vid = v1.id as number;
  for (let i = 0; i < 5; i++) await svc.assignTrader(vid, walletOf(i), 2000);
  await assert.rejects(() => svc.assignTrader(vid, walletOf(99)), /cap/);
  // Invalid wallet rejected; bad weight rejected.
  await assert.rejects(() => svc.assignTrader(vid, 'nope'), /không hợp lệ/);
  await assert.rejects(() => svc.assignTrader(vid, walletOf(0), 20000), /weightBps/);

  // 4. Remove deactivates (soft); re-assign beyond cap still blocked until slot frees.
  await svc.removeTrader(vid, walletOf(0));
  await svc.assignTrader(vid, walletOf(99), 1000); // slot freed → OK
  await assert.rejects(() => svc.assignTrader(vid, walletOf(100)), /cap/);
  await assert.rejects(() => svc.removeTrader(vid, walletOf(100)), /not tracked/);
  const after = (await svc.listVaults()) as { id: number; traders: Row[] }[];
  const active = after.find((v) => v.id === vid)?.traders.filter((t) => t.isActive) ?? [];
  assert.equal(active.length, 5);

  // 5. Deposit links userId when provided; anonymous stays null.
  const d1 = await svc.deposit(vid, 'carol', 2, 42);
  const d2 = await svc.deposit(vid, 'anon', 1);
  const deposits = (fake as unknown as { db: { deposit: Row[] } }).db.deposit;
  assert.equal(deposits.find((d) => d.id === d1.id)?.userId, 42);
  assert.equal(deposits.find((d) => d.id === d2.id)?.userId, null);

  // 6. Bots: create/list/mode + boundaries.
  const bots = new BotsService(fake);
  const b1 = (await bots.create('edgepool-auto', vid)) as Row;
  assert.equal(b1.mode, 'AUTO');
  await assert.rejects(() => bots.create('edgepool-auto'), /already exists/);
  await assert.rejects(() => bots.create('ghost', 999), /not found/);
  const b2 = (await bots.setMode(b1.id as number, 'PAUSED')) as Row;
  assert.equal(b2.mode, 'PAUSED');
  await assert.rejects(() => bots.setMode(b1.id as number, 'TURBO'), /không hợp lệ/);
  await assert.rejects(() => bots.setMode(999, 'AUTO'), /not found/);
  assert.equal(((await bots.list()) as Row[]).length, 1);

  console.log('multivault asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
