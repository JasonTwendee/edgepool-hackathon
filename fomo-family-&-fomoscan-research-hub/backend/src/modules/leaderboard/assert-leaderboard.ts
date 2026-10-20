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

function makeFake(opts: { openWallets?: string[]; activeTraders?: string[]; vaults?: number[] } = {}) {
  const db = {
    wallet: [] as Row[],
    tx: [] as Row[],
    vault: (opts.vaults ?? []).map((id) => ({ id, listing: 'public', status: 'live', maxTraders: 5 })),
    trader: [] as Row[],
  };
  const audits: Row[] = [];
  let seq = 0;
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (v !== null && typeof v === 'object') {
        const inVals = (v as Row).in;
        return Array.isArray(inVals) ? inVals.includes(r[k]) : true;
      }
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
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const ids = ((where.address as Row)?.in as string[]) ?? [];
        const rows = db.wallet.filter(
          (r) =>
            ids.includes(r.address as string) &&
            (where.isActive === undefined || r.isActive === where.isActive),
        );
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
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
    transaction: {
      groupBy: async ({ where }: { where: Row }) => {
        const addrs = new Set((((where.walletAddress as Row)?.in as string[]) ?? []));
        return db.tx.filter((r) => addrs.has(r.walletAddress as string)).map((r) => ({ walletAddress: r.walletAddress }));
      },
    },
    vaultTrader: {
      findMany: async ({ where = {} }: { where?: Row } = {}) => {
        const ids = ((where.vaultId as Row)?.in as number[]) ?? [];
        const vaultId = ids[0] ?? opts.vaults?.[0] ?? 1;
        return (opts.activeTraders ?? []).map((wallet, i) => ({
          id: 900 + i,
          vaultId,
          wallet,
          weightBps: 2000,
          isActive: true,
          enteredAt: new Date(0),
        }));
      },
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const key = where.vaultId_wallet as Row;
        const existing = db.trader.find(
          (t) => t.vaultId === key.vaultId && t.wallet === key.wallet,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: db.trader.length + 1, ...create };
        db.trader.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const notIn = ((where.wallet as Row)?.notIn as string[]) ?? [];
        const rows = db.trader.filter(
          (t) =>
            t.vaultId === where.vaultId &&
            t.isActive === where.isActive &&
            !notIn.includes(t.wallet as string),
        );
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    vault: {
      findMany: async ({ where = {} }: { where?: Row } = {}) =>
        db.vault.filter(
          (v) =>
            (where.listing === undefined || v.listing === where.listing) &&
            (where.status === undefined || v.status === where.status),
        ),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const ids = ((where.id as Row)?.in as number[]) ?? [];
        const rows = db.vault.filter((v) => ids.includes(v.id as number));
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
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
    getPnl: async (handle: string) => ({
      handle,
      wallet: '',
      evmWallet: null,
      status: 'ready',
      updatedAt: Math.floor(Date.now() / 1000),
      windows: {
        '24h': { netUsd: 10, returnPct: 1, volumeUsd: 100, trades: 5, buys: 3, sells: 2, tokensTraded: 2, winningTokens: 1, rank: 1, status: 'ready', updatedAt: 1 },
        '7d': { netUsd: 20, returnPct: 2, volumeUsd: 200, trades: 10, buys: 6, sells: 4, tokensTraded: 4, winningTokens: 3, rank: 2, status: 'ready', updatedAt: 1 },
        '30d': { netUsd: 30, returnPct: 3, volumeUsd: 300, trades: 20, buys: 12, sells: 8, tokensTraded: 8, winningTokens: 5, rank: 3, status: 'ready', updatedAt: 1 },
      },
    }),
    lookupWallet: async (address: string) => {
      if (!enrichOk) throw new Error('FomoScan 503');
      return { handle: 'h', profilePicture: `pic:${address}`, bio: null, evmAddress: null };
    },
  } as never;
}

const noopTransport = {
  addTrackedWallet: () => undefined,
  removeTrackedWallet: () => false,
  getTrackedWallets: () => [],
  watch: async () => undefined,
  unwatch: async () => undefined,
  resetTo: async () => undefined,
} as never;

/** Spy transport: records removals/unwatches/resets for prune-pipeline asserts. */
function spyTransport(registry: string[] = []): never & {
  removed: string[];
  unwatched: string[];
  reset: string[][];
} {
  const removed: string[] = [];
  const unwatched: string[] = [];
  const reset: string[][] = [];
  const live = [...registry];
  return {
    addTrackedWallet: () => undefined,
    removeTrackedWallet: (address: string) => {
      removed.push(address);
      const i = live.indexOf(address);
      if (i >= 0) live.splice(i, 1);
      return true;
    },
    getTrackedWallets: () => live.map((address) => ({ address })),
    watch: async () => undefined,
    unwatch: async (address: string) => {
      unwatched.push(address);
    },
    resetTo: async (addresses: string[]) => {
      reset.push(addresses);
    },
    removed,
    unwatched,
    reset,
  } as never;
}

function svcWith(prisma: never, fomoscan: never, audit?: never, transport?: never): LeaderboardService {
  const auditStub = (audit ?? { record: async () => ({ id: 1 }) }) as never;
  const t = (transport ?? noopTransport) as never;
  const wallets = { reconcileLiveStream: async () => 0 } as never;
  return new LeaderboardService(prisma, fomoscan, t, t, auditStub, wallets);
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
  // 1b. Window ranks snapshot per tick (24h/7d/30d), stub board shared.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '50', LEADERBOARD_PERIOD: 'weekly', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const world = makeFake();
    const svc = svcWith(world.prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]));
    await svc.tick();
    const rows = world.db.wallet as Row[];
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.rank24h, 1);
      assert.equal(r.rank7d, 1);
      assert.equal(r.rank30d, 1);
    }
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

  // 4b. Ví có lịch sử KHÔNG BAO GIỜ bị xóa cứng (deactivate-only rule):
  //    victim có tx → giữ INACTIVE, chỉ ví trắng bị prune.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '3', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma, db } = makeFake();
    const oldRow = (id: number, address: string): Row => ({
      id, address, label: 'o', handle: 'o', isActive: false,
      avatarUrl: null, bio: null, evmAddress: null, cumulativePnlUsd: null,
      winRate: null, allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01'),
    });
    db.wallet.push(oldRow(101, 'OLD1'), oldRow(102, 'OLD2'), oldRow(103, 'OLD3'));
    db.tx.push({ walletAddress: 'OLD2' }, { walletAddress: 'OLD3' });
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]));
    const s = await svc.tick();
    // total 5 > cap 3 → candidates OLD1, OLD2; OLD2 có history nên chỉ OLD1 bị xóa
    assert.equal(s.pruned, 1);
    assert.equal(s.total, 4);
    assert.ok(!db.wallet.some((r) => r.address === 'OLD1'));
    assert.ok(db.wallet.some((r) => r.address === 'OLD2'));
    assert.ok(db.wallet.some((r) => r.address === 'OLD3'));
    restore();
  }

  // 4c. Tick chồng tick bị bỏ qua (overlap guard).
  {
    const restore = env({ LEADERBOARD_TOP_N: '1', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const { prisma } = makeFake();
    const svc = svcWith(prisma, stub([]));
    (svc as unknown as { running: boolean }).running = true;
    const s = await svc.tick();
    assert.equal((s.note as string), 'concurrent-tick-skipped');
    assert.equal(s.pruned, 0);
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

  // 11. Reconcile: registry ghosts (not DB-active) are unsubscribed.
  {
    const restore = env({ LEADERBOARD_TOP_N: '2', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0' });
    const ghost = base58Encode(Buffer.alloc(32, 79));
    const { prisma, audit } = makeFake();
    const transport = spyTransport([walletOf(1), walletOf(2), ghost]);
    const svc = svcWith(prisma, stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b')]), audit, transport);
    await svc.tick();
    assert.ok((transport as { removed: string[] }).removed.includes(ghost));
    assert.ok((transport as { unwatched: string[] }).unwatched.includes(ghost));
    assert.ok(!(transport as { removed: string[] }).removed.includes(walletOf(1)));
    restore();
  }

  // 12. Pool mode: a live roster wallet outside topN is pinned active and is
  //     the only wallet wired into the live pipeline.
  {
    const restore = env({
      LEADERBOARD_TOP_N: '3', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0',
      LIVE_SCOPE_MODE: 'pool', LIVE_ROSTER_MODE: 'pin',
    });
    const liveAddr = walletOf(9);
    const { prisma, db } = makeFake({ activeTraders: [liveAddr] });
    db.wallet.push({
      id: 501, address: liveAddr, label: 'live', handle: 'live', isActive: false,
      avatarUrl: null, bio: null, evmAddress: null, cumulativePnlUsd: null,
      winRate: null, allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01'),
    });
    const transport = spyTransport();
    const svc = svcWith(
      prisma,
      stub([entry(walletOf(1), 'a'), entry(walletOf(2), 'b'), entry(walletOf(3), 'c')]),
      undefined,
      transport,
    );
    const s = await svc.tick();
    assert.ok((db.wallet.find((r) => r.address === liveAddr) as Row).isActive === true);
    const reset = (transport as { reset: string[][] }).reset.at(-1) ?? [];
    assert.deepEqual([...reset].sort(), [liveAddr]);
    assert.equal(s.active, 1); // only the pinned live trader is active
    restore();
  }

  // 13. Both public pools are re-synced to the same best-5 basket with equal
  //     weights (no drift, no 6th trader).
  {
    const restore = env({
      LEADERBOARD_TOP_N: '3', LEADERBOARD_CAP: '50', LEADERBOARD_SYNC_INTERVAL_MS: '0',
      LIVE_SCOPE_MODE: 'pool', LIVE_ROSTER_MODE: 'pin',
    });
    const wallets = [1, 2, 3, 4, 5, 6].map((n) => walletOf(n));
    const { prisma, db } = makeFake({ vaults: [14, 15], activeTraders: wallets });
    wallets.forEach((address, i) => {
      db.wallet.push({
        id: 600 + i, address, label: `t${i}`, handle: `t${i}`, isActive: true,
        rank24h: i + 1, rank7d: i + 1, rank30d: i + 1,
        cumulativePnlUsd: { toNumber: () => 100 - i },
        avatarUrl: 'pic', bio: null, evmAddress: null, winRate: null,
        allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01'),
      });
    });
    const svc = svcWith(prisma, stub(wallets.slice(0, 3).map((w, i) => entry(w, `n${i}`))));
    await svc.tick();
    const kept = wallets.slice(0, 5).sort();
    for (const id of [14, 15]) {
      const active = db.trader
        .filter((t) => t.vaultId === id && t.isActive)
        .map((t) => t.wallet as string)
        .sort();
      assert.deepEqual(active, kept, `vault ${id} shares the best-5 basket`);
      assert.ok(
        db.trader.filter((t) => t.vaultId === id).every((t) => t.weightBps === 2000),
        `vault ${id} equal 2000bps weights`,
      );
    }
    assert.equal((db.vault.find((v) => v.id === 14) as Row).maxTraders, 5);
    assert.equal((db.vault.find((v) => v.id === 15) as Row).maxTraders, 5);
    restore();
  }

  // 14. Top-mode rotation: new board roster gets a Fomo snapshot and starts a
  //     new term; both public pools share the same new 5.
  {
    const restore = env({
      LEADERBOARD_TOP_N: '5', LEADERBOARD_CAP: '50', LEADERBOARD_PERIOD: 'daily',
      LEADERBOARD_SYNC_INTERVAL_MS: '0', LIVE_SCOPE_MODE: 'pool', LIVE_ROSTER_MODE: 'top',
    });
    const old = [1, 2, 3, 4, 5].map((n) => walletOf(n));
    const next = [6, 7, 8, 9, 10].map((n) => walletOf(n));
    const { prisma, db } = makeFake({ vaults: [14, 15], activeTraders: old });
    const svc = svcWith(prisma, stub(next.map((w, i) => entry(w, `new${i}`))));
    await svc.tick();
    const expected = [...next].sort();
    for (const id of [14, 15]) {
      const active = db.trader
        .filter((t) => t.vaultId === id && t.isActive)
        .map((t) => t.wallet as string)
        .sort();
      assert.deepEqual(active, expected, `vault ${id} rotated to the new board`);
      assert.ok(
        db.trader.filter((t) => t.vaultId === id).every((t) => Boolean(t.entrySnapshot)),
        `vault ${id} persisted why-top snapshots`,
      );
    }
    restore();
  }

  console.log('leaderboard asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
