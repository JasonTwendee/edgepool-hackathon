/**
 * Executable evidence for fix 10 (prune archive-before-delete).
 * Run: `npx tsx src/modules/sync/assert-sync.ts` (mocked DB + tmpdir, no network).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncService } from './sync.service.js';

type Row = Record<string, unknown>;

function makeFake(opts: { tx: Row[]; ev: Row[]; failDelete?: boolean }) {
  const db = {
    tx: [...opts.tx],
    ev: [...opts.ev],
    // Money ledger sentinels — prune must never touch these tables.
    deposits: [{ id: 1 }] as Row[],
    withdrawals: [{ id: 2 }] as Row[],
    epochs: [{ id: 3 }] as Row[],
    payouts: [{ id: 4 }] as Row[],
  };
  const deletes: string[] = [];
  const audits: Row[] = [];
  const cutoffOf = (w: Row): number => Number((w.blockTime as { lt: bigint }).lt);
  const prisma = {
    transaction: {
      count: async ({ where }: { where: Row }) =>
        db.tx.filter((r) => Number(r.blockTime as bigint) < cutoffOf(where as Row)).length,
      findMany: async ({ where, take }: { where: Row; take?: number }) => {
        const rows = db.tx.filter((r) => Number(r.blockTime as bigint) < cutoffOf(where as Row));
        return take === undefined ? rows : rows.slice(0, take);
      },
      deleteMany: async ({ where }: { where: Row }) => {
        deletes.push('transaction');
        if (opts.failDelete) throw new Error('DB down');
        const ids = new Set(((where.signature as Row)?.in as string[]) ?? []);
        const before = db.tx.length;
        db.tx = db.tx.filter((r) => !ids.has(r.signature as string));
        return { count: before - db.tx.length };
      },
    },
    realtimeEvent: {
      count: async ({ where }: { where: Row }) =>
        db.ev.filter((r) => (r.broadcastedAt as Date) < ((where.broadcastedAt as Row)?.lt as Date)).length,
      findMany: async ({ where, take }: { where: Row; take?: number }) => {
        const rows = db.ev.filter((r) => (r.broadcastedAt as Date) < ((where.broadcastedAt as Row)?.lt as Date));
        return take === undefined ? rows : rows.slice(0, take);
      },
      deleteMany: async ({ where }: { where: Row }) => {
        deletes.push('realtimeEvent');
        if (opts.failDelete) throw new Error('DB down');
        const ids = new Set(((where.id as Row)?.in as number[]) ?? []);
        const before = db.ev.length;
        db.ev = db.ev.filter((r) => !ids.has(r.id as number));
        return { count: before - db.ev.length };
      },
    },
    deposit: { deleteMany: async () => { deletes.push('deposit'); return { count: 0 }; } },
    withdrawal: { deleteMany: async () => { deletes.push('withdrawal'); return { count: 0 }; } },
    epochCheckpoint: { deleteMany: async () => { deletes.push('epoch'); return { count: 0 }; } },
    partnerPayout: { deleteMany: async () => { deletes.push('payout'); return { count: 0 }; } },
  } as never;
  const wallets = { findAll: async () => [] } as never;
  const history = { syncWallet: async () => ({ added: 0, healed: 0, total: 0 }) } as never;
  const pnl = { syncWalletStats: async () => 0 } as never;
  const audit = {
    record: async (input: Row) => {
      audits.push(input);
      return { id: audits.length };
    },
  } as never;
  const svc = new SyncService(wallets, history, pnl, prisma, audit);
  return { svc, db, deletes, audits };
}

const oldTx = (sig: string): Row => ({
  signature: sig, walletAddress: 'W1', slot: 100n, blockTime: BigInt(Math.floor(Date.now() / 1000) - 121 * 86400),
  action: 'BUY', symbol: 'X', amountUsd: 1,
});
const newTx = (sig: string): Row => ({
  signature: sig, walletAddress: 'W1', slot: 200n, blockTime: BigInt(Math.floor(Date.now() / 1000) - 86400),
  action: 'BUY', symbol: 'X', amountUsd: 1,
});
const oldEv = (id: number): Row => ({ id, eventType: 'SWAP', walletAddress: 'W1', broadcastedAt: new Date(Date.now() - 121 * 86400000) });

async function main(): Promise<void> {
  // 1. Nothing old → 0, no audit, no deletes.
  {
    const { svc, deletes, audits } = makeFake({ tx: [newTx('n1')], ev: [] });
    svc.archiveDir = mkdtempSync(join(tmpdir(), 'prune-empty-'));
    assert.equal(await svc.pruneOnce(), 0);
    assert.deepEqual(deletes, []);
    assert.equal(audits.length, 0);
  }

  // 2. Old rows → JSONL archive + audit row + exact-ID deletes.
  {
    const dir = mkdtempSync(join(tmpdir(), 'prune-ok-'));
    const { svc, db, deletes, audits } = makeFake({ tx: [oldTx('o1'), oldTx('o2'), newTx('n1')], ev: [oldEv(11), oldEv(12)] });
    svc.archiveDir = dir;
    assert.equal(await svc.pruneOnce(), 4);
    assert.deepEqual(db.tx.map((r) => r.signature), ['n1']);
    assert.equal(db.ev.length, 0);
    assert.deepEqual(deletes.sort(), ['realtimeEvent', 'transaction']);
    assert.equal(audits.length, 1);
    assert.equal((audits[0] as Row).action, 'sync.prune_archive');
    const txLines = readFileSync(join(dir, (audits[0] as Row).target as string).split(',')[0], 'utf8').trim().split('\n');
    assert.equal(txLines.length, 2);
    const parsed = JSON.parse(txLines[0]) as Row;
    assert.equal(parsed.signature, 'o1');
    assert.equal(typeof parsed.blockTime, 'string'); // BigInt serialized safely
    assert.ok(readdirSync(dir).some((f) => f.endsWith('-transactions.jsonl')));
    // Money ledger untouched.
    assert.equal(db.deposits.length, 1);
    assert.equal(db.withdrawals.length, 1);
    assert.equal(db.epochs.length, 1);
    assert.equal(db.payouts.length, 1);
    assert.ok(!deletes.includes('deposit') && !deletes.includes('withdrawal') && !deletes.includes('epoch') && !deletes.includes('payout'));
  }

  // 3. Archive FS failure → zero deletes (fail-safe).
  {
    const { svc, db, deletes } = makeFake({ tx: [oldTx('o9')], ev: [] });
    const blocker = join(mkdtempSync(join(tmpdir(), 'prune-ro-')), 'file-not-dir');
    writeFileSync(blocker, 'x');
    svc.archiveDir = join(blocker, 'sub');
    assert.equal(await svc.pruneOnce(), 0);
    assert.equal(db.tx.length, 1);
    assert.deepEqual(deletes, []);
  }

  // 4. Multi-batch: 2500 old rows → 2000 + 500, cuốn chiếu, đủ tổng.
  {
    const dir = mkdtempSync(join(tmpdir(), 'prune-batch-'));
    const many = Array.from({ length: 2500 }, (_, i) => oldTx(`b${i}`));
    const { svc, db, deletes, audits } = makeFake({ tx: many, ev: [] });
    svc.archiveDir = dir;
    assert.equal(await svc.pruneOnce(), 2500);
    assert.equal(db.tx.length, 0);
    assert.equal(audits.length, 2);
    assert.deepEqual(deletes, ['transaction', 'transaction']);
    assert.ok(readdirSync(dir).some((f) => f.endsWith('-transactions.jsonl')));
  }

  console.log('sync asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
