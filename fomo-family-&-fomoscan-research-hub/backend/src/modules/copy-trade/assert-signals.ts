/**
 * Executable evidence for pool terminal log (signal stream).
 * Run: `npx tsx src/modules/copy-trade/assert-signals.ts` (no DB, no network).
 */
import assert from 'node:assert/strict';
import {
  emitSignal,
  replaySignals,
  resetSignalBus,
  subscribeSignals,
} from './signal-bus.js';
import { VaultService } from '../vaults/vault.service.js';

type Row = Record<string, unknown>;

async function main(): Promise<void> {
  // 1. Emit → replay preserves order.
  resetSignalBus();
  emitSignal({ vaultId: 1, kind: 'SKIP', token: '$A', trader: 't1', note: 'blocked: mint' });
  emitSignal({ vaultId: 1, kind: 'ENTER', token: '$B', trader: 't2', note: 'order #9 entered' });
  const replay = replaySignals(1);
  assert.equal(replay.length, 2);
  assert.equal(replay[0].kind, 'SKIP');
  assert.equal(replay[1].token, '$B');
  assert.ok(typeof replay[0].at === 'number');

  // 2. Per-vault isolation.
  emitSignal({ vaultId: 2, kind: 'ENTER', token: '$C', trader: 't3', note: 'other pool' });
  assert.equal(replaySignals(1).length, 2);
  assert.equal(replaySignals(2).length, 1);

  // 3. Live subscribe + unsubscribe.
  resetSignalBus();
  const seen: string[] = [];
  const unsub = subscribeSignals(7, (e) => seen.push(e.kind));
  emitSignal({ vaultId: 7, kind: 'EXIT', token: '$D', trader: 't4', note: 'TP1' });
  assert.deepEqual(seen, ['EXIT']);
  unsub();
  emitSignal({ vaultId: 7, kind: 'EXIT', token: '$E', trader: 't4', note: 'TP2' });
  assert.deepEqual(seen, ['EXIT']);

  // 4. Ring cap (200).
  resetSignalBus();
  for (let i = 0; i < 250; i++) {
    emitSignal({ vaultId: 3, kind: 'SKIP', token: `$T${i}`, trader: 't', note: 'x' });
  }
  const capped = replaySignals(3, 500);
  assert.equal(capped.length, 200);
  assert.equal(capped[0].token, '$T50');

  // 5. DB replay mapping: FAILED → SKIP, CONFIRMED → ENTER, closed → EXIT.
  const now = Date.now();
  const fake = {
    vault: { findUnique: async () => ({ id: 1 }) },
    copyOrder: {
      // Mimics orderBy id desc like the real query.
      findMany: async () => [
        { id: 2, symbol: '$B', tokenMint: 'm2', masterHandle: 't2', masterWallet: 'w2', status: 'CONFIRMED', error: null, closeReason: 'TP1_HIT', realizedPnlUsd: 1.5, createdAt: new Date(now - 1000), closedAt: new Date(now) },
        { id: 1, symbol: '$A', tokenMint: 'm1', masterHandle: 't1', masterWallet: 'w1', status: 'FAILED', error: 'Qualify blocked: mint', closeReason: null, realizedPnlUsd: 0, createdAt: new Date(now - 2000), closedAt: null },
      ],
    },
  } as never;
  const svc = new VaultService(fake);
  const evs = await svc.recentSignalEvents(1, 10);
  assert.equal(evs.length, 3);
  assert.equal(evs[0].kind, 'SKIP');
  assert.ok((evs[0].note as string).includes('mint'));
  assert.equal(evs[1].kind, 'ENTER');
  assert.equal(evs[2].kind, 'EXIT');
  assert.ok((evs[2].note as string).includes('TP1_HIT'));

  console.log('signals asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
