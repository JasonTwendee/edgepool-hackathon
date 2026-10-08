/**
 * Executable evidence for the admin signal-journey endpoint
 * (GET /api/vaults/:id/orders — terminal demo tab phase rail).
 * Run: `npx tsx src/modules/vaults/assert-journeys.ts` (mocked DB, no network).
 */
import assert from 'node:assert/strict';
import { VaultService } from './vault.service.js';

type Row = Record<string, unknown>;

function makeFake() {
  const now = Date.now();
  const db = {
    vault: [
      { id: 1, name: 'demo-verify', kind: 'basket', status: 'live', listing: 'unlisted', feeBps: 0, hwmSharePrice: 1, totalShares: 10, maxSlots: 100, maxTraders: 5, environment: 'SANDBOX', createdAt: new Date(now - 3600000) },
    ] as Row[],
    orders: [
      {
        id: 7, vaultId: 1, status: 'CONFIRMED', symbol: '$T', masterHandle: 't1', masterWallet: 'W1',
        masterTxHash: 'sig7', tokenMint: 'M1', amountUsd: 100, entryPriceUsd: 10, venue: 'Phoenix CLOB',
        entryMode: 'immediate', tp1Pct: 60, stopPct: 30, trailPct: null,
        quoteJson: { qualify: { mint: 'M1', pass: true, reasons: [], score: 1 }, sized: { masterUsd: 100, copyUsd: 10 } },
        closeReason: 'TIME_STOP', exitPriceUsd: 11, realizedPnlUsd: 10, createdAt: new Date(now - 1800000), closedAt: new Date(now - 60000),
        legs: [{ leg: 'TIME', fraction: 1, exitPriceUsd: 11, realizedPnlUsd: 10, closedAt: new Date(now - 60000) }],
      },
      {
        id: 8, vaultId: 1, status: 'FAILED', symbol: '$R', masterHandle: 't2', masterWallet: 'W2',
        masterTxHash: 'sig8', tokenMint: 'M2', amountUsd: 50, entryPriceUsd: null, venue: null,
        entryMode: 'immediate', tp1Pct: null, stopPct: null, trailPct: null,
        quoteJson: { qualify: { mint: 'M2', pass: false, reasons: ['mint authority'], score: 0 } },
        error: 'Qualify blocked: mint authority',
        closeReason: null, exitPriceUsd: null, realizedPnlUsd: null, createdAt: new Date(now - 1200000), closedAt: null,
        legs: [],
      },
      {
        id: 9, vaultId: 1, status: 'CONFIRMED', symbol: '$O', masterHandle: 't1', masterWallet: 'W1',
        masterTxHash: 'sig9', tokenMint: 'M3', amountUsd: 80, entryPriceUsd: 8, venue: 'Phoenix CLOB',
        entryMode: 'immediate', tp1Pct: 60, stopPct: 30, trailPct: null,
        quoteJson: null,
        closeReason: null, exitPriceUsd: null, realizedPnlUsd: null, createdAt: new Date(now - 300000), closedAt: null,
        legs: [{ leg: 'TP1', fraction: 0.4, exitPriceUsd: 13, realizedPnlUsd: 20, closedAt: new Date(now - 120000) }],
      },
    ] as Row[],
  };
  const match = (r: Row, w: Row): boolean =>
    Object.entries(w).every(([k, v]) => {
      if (v !== null && typeof v === 'object') return true;
      return r[k] === v;
    });
  const prisma = {
    vault: {
      findUnique: async ({ where }: { where: Row }) => db.vault.find((r) => match(r, where)) ?? null,
    },
    copyOrder: {
      findMany: async ({ where }: { where: Row }) =>
        db.orders.filter((r) => match(r, where)).sort((a, b) => (b.id as number) - (a.id as number)),
    },
  } as never;
  return { prisma };
}

async function main(): Promise<void> {
  const svc = new VaultService(makeFake().prisma);
  const rows = (await svc.ordersJourney(1)) as Row[];

  // Newest first, all three orders present.
  assert.deepEqual(rows.map((r) => r.id), [9, 8, 7]);

  // Closed winner: full phase evidence.
  const done = rows[2] as Row;
  assert.equal(done.status, 'CONFIRMED');
  assert.equal((done.qualify as Row).pass, true);
  assert.equal(((done.entry as Row).priceUsd as number), 10);
  assert.equal(((done.legs as Row[]).length), 1);
  assert.equal(done.closeReason, 'TIME_STOP');
  assert.equal(done.realizedPnlUsd, 10);

  // Failed gate: qualify verdict + error surfaced, exit stays null.
  const failed = rows[1] as Row;
  assert.equal(failed.status, 'FAILED');
  assert.equal((failed.qualify as Row).pass, false);
  assert.deepEqual((failed.qualify as Row).reasons, ['mint authority']);
  assert.equal(failed.error, 'Qualify blocked: mint authority');
  assert.equal(failed.closedAt, null);
  assert.equal(failed.realizedPnlUsd, null);

  // Open runner: partial TP1 leg visible, exit still null.
  const open = rows[0] as Row;
  assert.equal(open.closedAt, null);
  assert.equal(((open.legs as Row[])[0] as Row).leg, 'TP1');
  assert.equal((open.qualify as Row | null), null); // legacy row without verdict
  assert.equal(open.realizedPnlUsd, null);

  // Unknown vault refused.
  await assert.rejects(() => svc.ordersJourney(99), /not found/);

  console.log('journeys asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
