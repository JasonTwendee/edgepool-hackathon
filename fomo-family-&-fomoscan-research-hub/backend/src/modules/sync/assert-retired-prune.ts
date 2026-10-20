/**
 * Executable evidence for retired-trader raw-data cleanup.
 * Run: `npx tsx src/modules/sync/assert-retired-prune.ts` (mocked DB + tmpdir).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncService } from './sync.service.js';

type Row = Record<string, unknown>;

function makeFake(opts: { openOrder?: boolean } = {}) {
  const db = {
    tx: [{ walletAddress: 'OLD', signature: 'sig1', blockTime: 1n }] as Row[],
    ev: [{ id: 1, walletAddress: 'OLD', broadcastedAt: new Date() }] as Row[],
    deleted: [] as string[],
  };
  const audits: Row[] = [];
  const prisma = {
    vaultTrader: {
      findMany: async ({ where }: { where: Row }) => {
        if (where.isActive === false) return [{ wallet: 'OLD' }];
        return [];
      },
    },
    copyOrder: {
      findMany: async () => (opts.openOrder ? [{ masterWallet: 'OLD' }] : []),
    },
    transaction: {
      findMany: async () => [...db.tx],
      deleteMany: async () => {
        db.deleted.push('transaction');
        const count = db.tx.length;
        db.tx = [];
        return { count };
      },
    },
    realtimeEvent: {
      findMany: async () => [...db.ev],
      deleteMany: async () => {
        db.deleted.push('realtimeEvent');
        const count = db.ev.length;
        db.ev = [];
        return { count };
      },
    },
  } as never;
  const wallets = { findAllLive: async () => [], findLiveMemberships: async () => [] } as never;
  const history = { syncWallet: async () => ({ added: 0, healed: 0, total: 0 }) } as never;
  const pnl = { syncWalletStats: async () => 0 } as never;
  const audit = {
    record: async (input: Row) => {
      audits.push(input);
      return { id: audits.length };
    },
  } as never;
  const svc = new SyncService(wallets, history, pnl, prisma, audit);
  return { svc, db, audits };
}

async function main(): Promise<void> {
  // 1. Retired past grace → archive + audit + delete raw rows.
  {
    const { svc, db, audits } = makeFake();
    svc.archiveDir = mkdtempSync(join(tmpdir(), 'retired-prune-'));
    const n = await svc.pruneRetiredOnce();
    assert.equal(n, 2);
    assert.deepEqual(db.deleted.sort(), ['realtimeEvent', 'transaction']);
    assert.equal(db.tx.length, 0);
    assert.equal(db.ev.length, 0);
    assert.equal(audits.length, 1);
    assert.equal((audits[0] as Row).action, 'sync.retired_prune');
    assert.ok(((audits[0] as Row).metaJson as Row).wallet === 'OLD');
  }

  // 2. Open copy order → keep raw data (manage may still need context).
  {
    const { svc, db, audits } = makeFake({ openOrder: true });
    svc.archiveDir = mkdtempSync(join(tmpdir(), 'retired-open-'));
    const n = await svc.pruneRetiredOnce();
    assert.equal(n, 0);
    assert.deepEqual(db.deleted, []);
    assert.equal(db.tx.length, 1);
    assert.equal(audits.length, 0);
  }

  // 3. Archive failure → zero deletes (fail-safe).
  {
    const { svc, db } = makeFake();
    const blocker = join(mkdtempSync(join(tmpdir(), 'retired-ro-')), 'file-not-dir');
    writeFileSync(blocker, 'x');
    svc.archiveDir = join(blocker, 'sub');
    const n = await svc.pruneRetiredOnce();
    assert.equal(n, 0);
    assert.deepEqual(db.deleted, []);
    assert.equal(db.tx.length, 1);
  }

  console.log('retired-prune asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
