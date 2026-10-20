/**
 * Executable evidence for Fomo selection snapshots (why-top metrics).
 * Run: `npx tsx src/common/fomoscan/assert-selection-snapshot.ts` (no network).
 */
import assert from 'node:assert/strict';
import { buildSelectionSnapshot, hashSelectionSnapshot } from './selection-snapshot.js';

const entry = {
  rank: 3,
  wallet: 'Wallet111111111111111111111111111111111111111',
  username: 'trader',
  isVerified: true,
  pnlSol: 1,
  pnlUsd: 1000,
  pnlPercent: 10,
  realizedPnlUsd: 800,
  unrealizedPnlUsd: 200,
};

const pnl = {
  handle: 'trader',
  wallet: entry.wallet,
  evmWallet: null,
  status: 'ready',
  updatedAt: 1700000000,
  windows: {
    '24h': {
      netUsd: 100,
      returnPct: 5,
      volumeUsd: 1000,
      trades: 10,
      buys: 6,
      sells: 4,
      tokensTraded: 5,
      winningTokens: 3,
      rank: 3,
      status: 'ready',
      updatedAt: 1700000000,
    },
    '7d': {
      netUsd: 500,
      returnPct: 12,
      volumeUsd: 5000,
      trades: 40,
      buys: 20,
      sells: 20,
      tokensTraded: 10,
      winningTokens: 6,
      rank: 2,
      status: 'ready',
      updatedAt: 1700000000,
    },
    '30d': {
      netUsd: 900,
      returnPct: 20,
      volumeUsd: 9000,
      trades: 90,
      buys: 50,
      sells: 40,
      tokensTraded: 20,
      winningTokens: 11,
      rank: 1,
      status: 'ready',
      updatedAt: 1700000000,
    },
  },
};

const at = new Date('2026-10-20T10:00:00Z');
const snap = buildSelectionSnapshot(entry, pnl, 'daily', at);
assert.equal(snap.source, 'fomoscan');
assert.equal(snap.wallet, entry.wallet);
assert.equal(snap.handle, 'trader');
assert.deepEqual(snap.ranks, { h24: 3, d7: 2, d30: 1 });
assert.equal(snap.whyTop.primaryWindow, '24h');
assert.equal(snap.whyTop.primary?.winRatePct, 60);
assert.equal(snap.windows['7d'].winRatePct, 60);
assert.equal(snap.whyTop.pnlUsd, 1000);
const hash = hashSelectionSnapshot(snap);
assert.equal(hash.length, 64);
assert.equal(hashSelectionSnapshot(snap), hash);
assert.notEqual(
  hashSelectionSnapshot({ ...snap, fetchedAt: '2026-10-20T10:00:00.001Z' }),
  hash,
);

// Missing PnL still yields a board-only snapshot (fail-open for rotation).
const partial = buildSelectionSnapshot(entry, null, 'weekly', at);
assert.equal(partial.raw.pnl, null);
assert.equal(partial.whyTop.primary, null);
assert.equal(partial.ranks.d7, 3);

console.log('selection-snapshot asserts: ALL GREEN');
