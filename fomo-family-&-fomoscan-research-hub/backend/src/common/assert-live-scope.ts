/**
 * Executable evidence for live-scope selection + live-pipeline guards.
 * Run: `npx tsx src/common/assert-live-scope.ts` (no network/DB).
 */
import assert from 'node:assert/strict';
import { selectLiveScope } from './live-scope.js';
import { Debouncer } from './debounce.js';
import { EventBuffer } from './event-buffer.js';

async function main(): Promise<void> {
  // 1. Pool mode follows exactly the distinct roster wallets.
  {
    const scope = selectLiveScope(
      [{ wallet: 'A' }, { wallet: 'B' }, { wallet: 'A' }],
      'pool',
    );
    assert.equal(scope.mode, 'pool');
    assert.deepEqual([...scope.addresses].sort(), ['A', 'B']);
  }

  // 2. Explicit all mode ignores the roster.
  {
    const scope = selectLiveScope([{ wallet: 'A' }], 'all');
    assert.equal(scope.mode, 'all');
    assert.equal(scope.addresses.size, 0);
  }

  // 3. Empty pool roster falls back to all (fresh/dev bootstrap).
  {
    const scope = selectLiveScope([], 'pool');
    assert.equal(scope.mode, 'all');
    assert.equal(scope.addresses.size, 0);
  }

  // 4. Debouncer coalesces a burst for one wallet into one run.
  {
    let runs = 0;
    const keys: string[] = [];
    const d = new Debouncer(20, (key) => {
      runs++;
      keys.push(key);
    });
    for (let i = 0; i < 5; i++) d.schedule('W1');
    d.schedule('W2');
    assert.equal(d.pendingCount(), 2);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(runs, 2);
    assert.deepEqual(keys.sort(), ['W1', 'W2']);
    assert.equal(d.pendingCount(), 0);
  }

  // 5. flush runs immediately; clear cancels pending.
  {
    let runs = 0;
    const d = new Debouncer(5000, () => runs++);
    d.schedule('W1');
    d.flush('W1');
    assert.equal(runs, 1);
    d.schedule('W2');
    d.clear();
    assert.equal(d.pendingCount(), 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runs, 1);
  }

  // 6. 0ms debounce is immediate (rollback switch).
  {
    let runs = 0;
    const d = new Debouncer(0, () => runs++);
    d.schedule('W1');
    assert.equal(runs, 1);
  }

  // 7. SSE buffer drains in order and keeps only the newest N items.
  {
    const buf = new EventBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    assert.deepEqual(buf.drain(), [1, 2]);
    assert.equal(buf.size(), 0);
    for (let i = 0; i < 5; i++) buf.push(i);
    assert.deepEqual(buf.drain(), [2, 3, 4]);
  }

  console.log('live-scope asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
