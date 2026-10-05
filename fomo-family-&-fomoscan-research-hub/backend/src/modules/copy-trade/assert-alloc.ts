/**
 * Executable evidence for dynamic allocation (scoring + rebalance + sizing slice).
 * Run: `npx tsx src/modules/copy-trade/assert-alloc.ts` (mocked, no network).
 */
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { AllocationService, scoreTraders } from './allocation.service.js';
import { CopyTradeService } from './copy-trade.service.js';
import { AuditService } from '../audit/audit.service.js';

type Row = Record<string, unknown>;

function makeRebalanceFake(traders: Row[], closed: Row[]) {
  const audits: Row[] = [];
  const written: Row[] = [];
  const prisma = {
    vault: { findMany: async () => [{ id: 1 }] },
    vaultTrader: {
      findMany: async () => [...traders],
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        written.push({ where, data });
        return { count: 1 };
      },
    },
    copyOrder: { findMany: async () => [...closed] },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: audits.length + 1, createdAt: new Date(), ...data };
        audits.push(r);
        return r;
      },
      count: async () => audits.length,
      findMany: async () => [...audits],
    },
  } as never;
  const svc = new AllocationService(prisma, new AuditService(prisma));
  return { svc, audits, written };
}

async function main(): Promise<void> {
  // 1. Scoring: empty, single, neutral-thin-history.
  assert.deepEqual(scoreTraders([]), []);
  const single = scoreTraders([{ wallet: 'A', wins: 5, losses: 0, realized: 100 }]);
  assert.equal(single.length, 1);
  assert.equal(single[0].weightBps, 10000);
  const thin = scoreTraders([
    { wallet: 'A', wins: 1, losses: 0, realized: 50 },
    { wallet: 'B', wins: 0, losses: 0, realized: 0 },
  ]);
  // Both neutral-ish (n<3): A ranks first on realized → A > B, sums to 10000.
  const thinSum = thin.reduce((s, t) => s + t.weightBps, 0);
  assert.equal(thinSum, 10000);
  assert.ok(thin.find((t) => t.wallet === 'A')!.weightBps > thin.find((t) => t.wallet === 'B')!.weightBps);

  // 2. Rank + clamp + normalize: skilled trader capped, sums to 10000.
  const ranked = scoreTraders([
    { wallet: 'STAR', wins: 9, losses: 1, realized: 5000 },
    { wallet: 'MID', wins: 5, losses: 5, realized: 500 },
    { wallet: 'TAIL', wins: 0, losses: 6, realized: -200 },
  ]);
  const sum = ranked.reduce((s, t) => s + t.weightBps, 0);
  assert.equal(sum, 10000);
  assert.ok(ranked.every((t) => t.weightBps >= 500 && t.weightBps <= 4000));
  const byWallet = new Map(ranked.map((t) => [t.wallet, t.weightBps]));
  assert.ok(byWallet.get('STAR')! >= byWallet.get('MID')! && byWallet.get('MID')! >= byWallet.get('TAIL')!);
  assert.ok(byWallet.get('STAR')! > byWallet.get('TAIL')!);

  // 3. Rebalance: no traders → zeros, no writes.
  {
    const w = makeRebalanceFake([], []);
    const r = await w.svc.rebalance(1);
    assert.deepEqual([r.updated, w.written.length, w.audits.length], [0, 0, 0]);
  }
  // 4. Rebalance writes weights summing to 10000 + audit actor.
  {
    const traders = [
      { id: 1, vaultId: 1, wallet: 'WA', isActive: true },
      { id: 2, vaultId: 1, wallet: 'WB', isActive: true },
    ];
    const closed = [
      { masterWallet: 'WA', realizedPnlUsd: 30 },
      { masterWallet: 'WA', realizedPnlUsd: 20 },
      { masterWallet: 'WA', realizedPnlUsd: -5 },
      { masterWallet: 'WB', realizedPnlUsd: -10 },
    ];
    const w = makeRebalanceFake(traders, closed);
    const r = await w.svc.rebalance(1);
    assert.equal(r.updated, 2);
    const total = r.weights.reduce((s, x) => s + x.weightBps, 0);
    assert.equal(total, 10000);
    assert.ok(r.weights.find((x) => x.wallet === 'WA')!.weightBps > r.weights.find((x) => x.wallet === 'WB')!.weightBps);
    assert.equal(w.audits.length, 1);
    assert.equal(w.audits[0].actor, 'alloc:rebalance');
    assert.equal(w.audits[0].action, 'copy.alloc_rebalance');
  }
  // 5. Loop default OFF (env unset in test).
  {
    const w = makeRebalanceFake([], []);
    delete process.env.COPY_ALLOC_INTERVAL_MS;
    w.svc.onModuleInit();
    assert.equal((w.svc as unknown as Row).timer, undefined);
  }

  // 6. Sizing slice: NAV cap $10, weights 7500/2500 → trader caps $7.5/$2.5.
  // Legacy (no traders) → full $10 cap.
  {
    const orders: Record<string, Row> = {};
    let seq = 0;
    const traders = [
      { wallet: 'WA', weightBps: 7500, vaultId: 1, isActive: true },
      { wallet: 'WB', weightBps: 2500, vaultId: 1, isActive: true },
    ];
    const fakePrisma = {
      vaultTrader: { findMany: async () => [...traders] },
      copyOrder: {
        create: async ({ data }: { data: Row }) => {
          seq += 1;
          orders[String(seq)] = { ...data, id: seq, createdAt: new Date() };
          return orders[String(seq)];
        },
        update: async ({ where, data }: { where: Row; data: Row }) => {
          Object.assign(orders[String(where.id)], data);
          return orders[String(where.id)];
        },
        count: async () => 0,
        findFirst: async () => null,
      },
    } as never;
    const stubExecutor = {
      assertDevnet: async () => undefined,
      fetchQuote: async () => ({ outAmount: '1', otherAmountThreshold: '1' }),
      loadVaultKeypair: () => Keypair.generate(),
      executeProof: async () => ({ signature: 'q'.padEnd(88, '8'), slot: 1 }),
    } as never;
    const svc = new CopyTradeService(
      fakePrisma,
      stubExecutor,
      { qualify: async () => ({ pass: true, reasons: [], verdict: {} }) } as never,
      { bulkPrices: async () => ({ So11111111111111111111111111111111111111112: 100 }), tokenDetails: async () => null, candles: async () => [] } as never,
      { status: async () => ({ lastEpoch: { navSol: 18 } }) } as never,
    );
    const base = { mode: 'paper' as const, confirm: true as const, symbol: 'SOL', action: 'BUY' as const };
    const a = await svc.executePaper(
      { ...base, masterWallet: 'WA', amountUsd: 50 },
      { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
    );
    assert.equal(a.status, 'CONFIRMED');
    const rowA = orders[String(a.id)] as unknown as { quoteJson: { sized: { copyUsd: number; alloc: { mode: string } } } };
    assert.equal(rowA.quoteJson.sized.copyUsd, 7.5);
    assert.equal(rowA.quoteJson.sized.alloc.mode, 'weighted');
    // Legacy: empty trader set → full cap.
    traders.length = 0;
    const b = await svc.executePaper(
      { ...base, masterWallet: 'WZ', amountUsd: 50 },
      { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
    );
    const rowB = orders[String(b.id)] as unknown as { quoteJson: { sized: { copyUsd: number; alloc: { mode: string } } } };
    assert.equal(rowB.quoteJson.sized.copyUsd, 10);
    assert.equal(rowB.quoteJson.sized.alloc.mode, 'unweighted');
  }

  console.log('alloc asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
