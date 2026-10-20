/**
 * Executable evidence for wallet FomoScan enrichment (P1).
 * Run: `npx tsx src/modules/wallets/assert-enrich.ts` (mocked DB + stubbed FomoScan).
 */
import assert from 'node:assert/strict';
import { WalletsService } from './wallets.service.js';

type Row = Record<string, unknown>;

function makeFake() {
  const db = {
    wallet: [
      { address: 'W1', label: 'T1', handle: 't1', avatarUrl: null, bio: null, evmAddress: null, cumulativePnlUsd: null, winRate: null, isActive: true, allocationWeight: { toNumber: () => 1 }, createdAt: new Date('2026-01-01') },
    ] as Row[],
  };
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const prisma = {
    trackedWallet: {
      findUnique: async ({ where }: { where: Row }) => db.wallet.find((r) => match(r, where)) ?? null,
      findMany: async ({ where = {} }: { where?: Row } = {}) => db.wallet.filter((r) => match(r, where)),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const ids = ((where.address as Row)?.in as string[]) ?? '';
        const rows = db.wallet.filter(
          (r) =>
            (Array.isArray(ids) ? ids.includes(r.address as string) : false) &&
            (where.isActive === undefined || r.isActive === where.isActive),
        );
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const r = db.wallet.find((x) => match(x, where)) as Row;
        // Mimic Prisma: Decimal columns come back as Decimal (toNumber()).
        if (typeof data.allocationWeight === 'number') {
          const n = data.allocationWeight as number;
          data = { ...data, allocationWeight: { toNumber: () => n } };
        }
        Object.assign(r, data);
        return r;
      },
    },
    // Empty roster → legacy fallback (DB-active) keeps this unit test hermetic.
    vaultTrader: { findMany: async () => [] },
  } as never;
  const noop = { addTrackedWallet: () => undefined };
  return { prisma, solana: noop, stream: noop } as unknown as {
    prisma: never;
    solana: never;
    stream: never;
  };
}

function svcWith(fake: { prisma: never; solana: never; stream: never }, fomoscan: never): WalletsService {
  return new WalletsService(fake.prisma as never, fake.solana as never, fake.stream as never, fomoscan);
}

function stubFomoscan(identity: Row | null, calls: string[]) {
  return {
    lookupWallet: async (address: string) => {
      calls.push(address);
      if (!identity) {
        const e = new Error('FomoScan 404 for GET /v2/user/wallet/W9') as Error;
        throw e;
      }
      return identity;
    },
  } as never;
}

async function main(): Promise<void> {
  // 1. Enrich fills avatar/bio/EVM from the verified identity.
  {
    const calls: string[] = [];
    const fake = makeFake();
    const svc = svcWith(fake, stubFomoscan({
      handle: 't1', profilePicture: 'https://pic/t1', bio: 'trader bio', evmAddress: '0xabc',
    }, calls));
    const out = await svc.enrich('W1') as unknown as Row;
    assert.equal(out.avatar, 'https://pic/t1');
    assert.equal(out.bio, 'trader bio');
    assert.equal(out.evmAddress, '0xabc');
    assert.deepEqual(calls, ['W1']);
  }

  // 2. Nulls from FomoScan never blank existing local values.
  {
    const fake = makeFake();
    const svc = svcWith(fake, stubFomoscan({
      handle: 't1', profilePicture: null, bio: null, evmAddress: null,
    }, []));
    const out = await svc.enrich('W1') as unknown as Row;
    assert.equal(out.avatar, undefined);
    assert.equal(out.bio, null);
  }

  // 3. Unknown wallet → 404; blank address → 400.
  {
    const fake = makeFake();
    const svc = svcWith(fake, stubFomoscan({}, []));
    await assert.rejects(() => svc.enrich('W9'), /not tracked/);
    await assert.rejects(() => svc.enrich('  '), /required/);
  }

  // 4. Unknown to FomoScan → clean 404 (no partial write of identity fields).
  {
    const fake = makeFake();
    const svc = svcWith(fake, stubFomoscan(null, []));
    await assert.rejects(() => svc.enrich('W1'), /No verified FomoScan identity/);
  }

  // 5. Deactivate → DB flag off + live scope reconciled to empty; reactivate
  // re-adds it. The scope reconcile (not an ad-hoc unwatch) owns WS slots now.
  {
    const resets: string[][] = [];
    const fake = makeFake();
    const stream = {
      resetTo: async (addresses: string[]) => {
        resets.push([...addresses]);
      },
    };
    const solana = {
      updateWalletCopyConfig: () => true,
      getTrackedWallets: () => [],
      removeTrackedWallet: () => false,
      addTrackedWallet: () => undefined,
    };
    const svc = new WalletsService(fake.prisma as never, solana as never, stream as never, stubFomoscan(null, []) as never);
    assert.equal(await svc.updateCopyConfig('W1', { isCopyEnabled: false } as never), true);
    assert.deepEqual(resets.at(-1), []);
    const afterOff = await (
      fake.prisma as unknown as { trackedWallet: { findUnique: (a: unknown) => Promise<Row> } }
    ).trackedWallet.findUnique({ where: { address: 'W1' } });
    assert.equal(afterOff.isActive, false);
    assert.equal(await svc.updateCopyConfig('W1', { isCopyEnabled: true } as never), true);
    assert.deepEqual(resets.at(-1), ['W1']);
    assert.equal(await svc.updateCopyConfig('W9', { isCopyEnabled: false } as never), false);
  }

  console.log('enrich asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
