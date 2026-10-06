/**
 * Executable evidence for leaderboard rotation (auto top-N, cap, no cash-out).
 * Run: `npx tsx src/modules/leaderboard/assert-leaderboard.ts` (mocked DB + stubbed FomoScan).
 */
import assert from 'node:assert/strict';
import { LeaderboardService } from './leaderboard.service.js';
import { base58Encode } from '../../common/auth/solana-verify.js';

type Row = Record<string, unknown>;

/** Deterministic valid Solana wallets for rotation fixtures. */
function walletOf(n: number): string {
  return base58Encode(Buffer.alloc(32, n & 0xff));
}

function entry(wallet: string, username: string, verified = true): Row {
  return { rank: 1, wallet, username, isVerified: verified, pnlSol: 1, pnlUsd: 2, pnlPercent: 3, realizedPnlUsd: 4, unrealizedPnlUsd: 5 };
}

function makeFake(opts: { openWallets?: string[]; activeTraders?: string[] } = {}) {
  const db = { wallet: [] as Row[] };
  const audits: Row[] = [];
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
        const r = {
          id: (seq += 1),
          avatarUrl: null,
          bio: null,
          evmAddress: null,
          cumulativePnlUsd: null,
          winRate: null,
          createdAt: new Date('2026-01-01'),
          ...data,
          // mimic Prisma Decimal
          allocationWeight: { toNumber: () => Number(data.allocationWeight ?? 1) },
          fomoPnlUsd:
            data.fomoPnlUsd === null || data.fomoPnlUsd === undefined
              ? null
              : { toNumber: () => Number(data.fomoPnlUsd as number) },
        };
        db.wallet.push(r);
        return r;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.wallet.find((x) => match(x, where)) as Row;
        const normalized = { ...data };
        if ('fomoPnlUsd' in normalized && normalized.fomoPnlUsd !== null && normalized.fomoPnlUsd !== undefined) {
          normalized.fomoPnlUsd = { toNumber: () => Number(normalized.fomoPnlUsd as number) };
        }
        Object.assign(r, normalized);
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
    copyOrder: {
      findMany: async () => (opts.openWallets ?? []).map((masterWallet) => ({ masterWallet })),
    },
    vaultTrader: {
      findMany: async () => (opts.activeTraders ?? []).map((wallet) => ({ wallet })),
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: audits.length + 1, createdAt: new Date(), ...data };
        audits.push(r);
        return r;
      },
    },
  } as never;
  const audit = { record: async (input: Row) => {
    const r = { id: audits.length + 1, createdAt: new Date(), ...input };
    audits.push(r);
    return { id: r.id };
  } } as never;
  return { prisma, audit, audits, db };
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

const noopTransport = {
  addTrackedWallet: () => undefined,
  removeTrackedWallet: () => false,
  watch: async () => undefined,
  unwatch: async () => undefined,
} as never;

/** Spy transport: records removals/unwatches for prune-pipeline asserts. */
function spyTransport(): never & { removed: string[]; unwatched: string[] } {
  const removed: string[] = [];
  const unwatched: string[] = [];
  return {
    addTrackedWallet: () => undefined,
    removeTrackedWallet: (address: string) => {
      removed.push(address);
      return true;
    },
    watch: async () => undefined,
    unwatch: async (address: string) => {
      unwatched.push(address);
    },
    removed,
    unwatched,
  } as never;
}

function svcWith(prisma: never, fomoscan: never, audit?: never, transport?: never): LeaderboardService {
  const auditStub = (audit ?? { record: async () => ({ id: 1 }) }) as never;
  const t = (transport ?? noopTransport) as never;
  return new LeaderboardService(prisma, fomoscan, t, t, auditStub);
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
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b'), entry(walletOf(3), 'c')]));
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
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]));
    await svc.tick();
    const svc2 = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(4), 'd')]));
    const s = await svc2.tick();
    assert.equal(s.added, 1);
    assert.equal(s.deactivated, 1);
    const b = db.wallet.find((r) => r.address === walletOf(2));
    assert.ok(b && b.isActive === false); // row + history kept, just inactive
    restore();
  }

  // 4. Cap prunes oldest INACTIVE only, never active.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '4', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma, db } = makeFake();
    const oldRow = (id: number, address: string): Row => ({
      id, address, label: 'o', handle: 'o', isActive: false,
      avatarUrl: null, bio: null, evmAddress: null, cumulativePnlUsd: null,
      winRate: null, allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01'),
    });
    db.wallet.push(oldRow(101, 'OLD1'), oldRow(102, 'OLD2'), oldRow(103, 'OLD3'));
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]));
    const s = await svc.tick();
    assert.equal(s.total, 4);
    assert.equal(s.pruned, 1);
    assert.ok(!db.wallet.some((r) => r.address === 'OLD1')); // oldest pruned
    assert.ok(db.wallet.some((r) => r.address === walletOf(1) && r.isActive === true));
    restore();
  }

  // 5. Enrich failure never blocks rotation.
  {
    const restore = env({ LEADERBOARD_TOP_N: '1', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma, db } = makeFake();
    const svc = svcWith(prisma, stub([entry(walletOf(26), 'z')], false));
    const s = await svc.tick();
    assert.equal(s.added, 1);
    assert.ok(db.wallet.some((r) => r.address === walletOf(26) && r.isActive === true));
    restore();
  }

  // 6. Status reflects config + counts (defaults: top 20, cap 20).
  {
    const restore = env({ LEADERBOARD_TOP_N: '20', LEADERBOARD_CAP: '20', LEADERBOARD_PERIOD: 'weekly', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma } = makeFake();
    const svc = svcWith(prisma, stub([]));
    const st = await svc.status();
    assert.equal(st.topN, 20);
    assert.equal(st.cap, 20);
    assert.equal(st.total, 0);
    restore();
  }

  // 7. Non-Solana / unverified entries never enter tracking.
  {
    const restore = env({ LEADERBOARD_TOP_N: '5', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma } = makeFake();
    const svc = svcWith(prisma, stub([entry(walletOf(40), 'ok'), entry('not-a-wallet', 'bad'), entry(walletOf(41), 'nover', false)]));
    const s = await svc.tick();
    assert.equal(s.added, 1);
    assert.equal(s.active, 1);
    restore();
  }

  // 8. Fix 11: INACTIVE wallet with an open order survives cap pressure.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '3', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const oldAddr = base58Encode(Buffer.alloc(32, 77));
    const { prisma, audit, audits, db } = makeFake({ openWallets: [oldAddr] });
    db.wallet.push({
      id: 201, address: oldAddr, label: 'o', handle: 'o', isActive: false,
      avatarUrl: null, bio: null, evmAddress: null, cumulativePnlUsd: null,
      winRate: null, allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01'),
    });
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]), audit);
    const s = await svc.tick();
    assert.equal(s.pruned, 0);
    assert.ok(db.wallet.some((r) => r.address === oldAddr)); // kept: open order references it
    assert.ok(!audits.some((a) => a.action === 'wallet.rotation_prune'));
    restore();
  }

  // 9. Fix 11: INACTIVE wallet in an ACTIVE trader set survives cap pressure.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '3', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const oldAddr = base58Encode(Buffer.alloc(32, 78));
    const { prisma, audit, db } = makeFake({ activeTraders: [oldAddr] });
    db.wallet.push({
      id: 202, address: oldAddr, label: 'o', handle: 'o', isActive: false,
      avatarUrl: null, bio: null, evmAddress: null, cumulativePnlUsd: null,
      winRate: null, allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01'),
    });
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]), audit);
    const s = await svc.tick();
    assert.equal(s.pruned, 0);
    assert.ok(db.wallet.some((r) => r.address === oldAddr)); // kept: pool still copies it
    restore();
  }

  // 10. Fix 11: real prune writes an audit row naming victims.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '4', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma, audit, audits, db } = makeFake();
    const oldRow = (id: number, address: string): Row => ({
      id, address, label: 'o', handle: 'o', isActive: false,
      avatarUrl: null, bio: null, evmAddress: null, cumulativePnlUsd: null,
      winRate: null, allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01'),
    });
    db.wallet.push(oldRow(101, 'OLD1'), oldRow(102, 'OLD2'), oldRow(103, 'OLD3'));
    const transport = spyTransport();
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]), audit, transport);
    const s = await svc.tick();
    assert.equal(s.pruned, 1);
    assert.ok(!db.wallet.some((r) => r.address === 'OLD1'));
    const row = audits.find((a) => a.action === 'wallet.rotation_prune');
    assert.ok(row, 'prune audit row written');
    assert.ok(((row as Row).target as string).includes('OLD1'));
    // Pruned victims leave the live pipeline (no ghost subs/polls).
    assert.ok(
      (transport as { removed: string[] }).removed.includes('OLD1'),
      'listener unwatched pruned wallet',
    );
    assert.ok(
      (transport as { unwatched: string[] }).unwatched.includes('OLD1'),
      'stream unsubscribed pruned wallet',
    );
    restore();
  }

  console.log('leaderboard asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
