/**
 * Executable evidence for leaderboard rotation (auto top-N, cap, no cash-out).
 * Run: `npx tsx src/modules/leaderboard/assert-leaderboard.ts` (mocked DB + stubbed FomoScan).
 */
import assert from 'node:assert/strict';
import { LeaderboardService } from './leaderboard.service.js';

type Row = Record<string, unknown>;

function entry(wallet: string, username: string): Row {
  return { rank: 1, wallet, username, isVerified: true, pnlSol: 1, pnlUsd: 2, pnlPercent: 3, realizedPnlUsd: 4, unrealizedPnlUsd: 5 };
}

function makeFake() {
  const db = { wallet: [] as Row[] };
  let seq = 0;
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const prisma = {
    trackedWallet: {
      findUnique: async ({ where }: { where: Row }) => db.wallet.find((r) => match(r, where)) ?? null,
      findMany: async ({ where = {}, orderBy, take }: { where?: Row; orderBy?: Row; take?: number }) => {
        let rows = db.wallet.filter((r) => match(r, where));
        if (orderBy && 'id' in orderBy) rows = [...rows].sort((a, b) => (a.id as number) - (b.id as number));
        return take === undefined ? rows : rows.slice(0, take);
      },
      create: async ({ data }: { data: Row }) => {
        const r = { id: (seq += 1), ...data };
        db.wallet.push(r);
        return r;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.wallet.find((x) => match(x, where)) as Row;
        Object.assign(r, data);
        return r;
      },
      count: async ({ where }: { where?: Row } = {}) =>
        where ? db.wallet.filter((r) => match(r, where)).length : db.wallet.length,
      deleteMany: async ({ where }: { where: Row }) => {
        const ids = ((where.id as Row)?.in as number[]) ?? [];
        const before = db.wallet.length;
        db.wallet = db.wallet.filter((r) => !ids.includes(r.id as number));
        return { count: before - db.wallet.length };
      },
    },
  } as never;
  return { prisma, db };
}

function stub(order: Row[], enrichOk = true) {
  return {
    leaderboard: async () => ({ entries: order }),
    lookupWallet: async (address: string) => {
      if (!enrichOk) throw new Error('FomoScan 503');
      return { handle: 'h', profilePicture: `pic:${address}`, bio: null, evmAddress: null };
    },
  } as never;
}

function env(vars: Record<string, string | undefined>): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

async function main(): Promise<void> {
  // 1. Fresh sync adds topN as active.
  {
    const restore = env({ LEADERBOARD_TOP_N: '3', LEADERBOARD_CAP: '50', LEADERBOARD_PERIOD: 'weekly', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma } = makeFake();
    const svc = new LeaderboardService(prisma, stub([entry('A', 'a'), entry('B', 'b'), entry('C', 'c')]));
    const s = await svc.tick();
    assert.equal(s.added, 3);
    assert.equal(s.active, 3);
    assert.equal(s.total, 3);
    // 2. Re-run is idempotent.
    const s2 = await svc.tick();
    assert.equal(s2.added, 0);
    assert.equal(s2.deactivated, 0);
    restore();
  }

  // 3. Drop → deactivated, history row kept; newcomer added.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma, db } = makeFake();
    const svc = new LeaderboardService(prisma, stub([entry('A', 'a'), entry('B', 'b')]));
    await svc.tick();
    const svc2 = new LeaderboardService(prisma, stub([entry('A', 'a'), entry('D', 'd')]));
    const s = await svc2.tick();
    assert.equal(s.added, 1);
    assert.equal(s.deactivated, 1);
    const b = db.wallet.find((r) => r.address === 'B');
    assert.ok(b && b.isActive === false); // row + history kept, just inactive
    restore();
  }

  // 4. Cap prunes oldest INACTIVE only, never active.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '4', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma, db } = makeFake();
    db.wallet.push(
      { id: 101, address: 'OLD1', label: 'o', handle: 'o', isActive: false },
      { id: 102, address: 'OLD2', label: 'o', handle: 'o', isActive: false },
      { id: 103, address: 'OLD3', label: 'o', handle: 'o', isActive: false },
    );
    const svc = new LeaderboardService(prisma, stub([entry('A', 'a'), entry('B', 'b')]));
    const s = await svc.tick();
    assert.equal(s.total, 4);
    assert.equal(s.pruned, 1);
    assert.ok(!db.wallet.some((r) => r.address === 'OLD1')); // oldest pruned
    assert.ok(db.wallet.some((r) => r.address === 'A' && r.isActive === true));
    restore();
  }

  // 5. Enrich failure never blocks rotation.
  {
    const restore = env({ LEADERBOARD_TOP_N: '1', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma, db } = makeFake();
    const svc = new LeaderboardService(prisma, stub([entry('Z', 'z')], false));
    const s = await svc.tick();
    assert.equal(s.added, 1);
    assert.ok(db.wallet.some((r) => r.address === 'Z' && r.isActive === true));
    restore();
  }

  // 6. Status reflects config + counts.
  {
    const restore = env({ LEADERBOARD_TOP_N: '20', LEADERBOARD_CAP: '50', LEADERBOARD_PERIOD: 'weekly', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma } = makeFake();
    const svc = new LeaderboardService(prisma, stub([]));
    const st = await svc.status();
    assert.equal(st.topN, 20);
    assert.equal(st.cap, 50);
    assert.equal(st.total, 0);
    restore();
  }

  console.log('leaderboard asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
