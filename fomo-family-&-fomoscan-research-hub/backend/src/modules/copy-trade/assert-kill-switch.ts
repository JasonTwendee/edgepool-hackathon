/**
 * Regression evidence: kill-switch measures SHARE PRICE, not flow-driven NAV.
 * A 0.5 SOL deposit + 0.9 SOL withdrawal moves NAV but must not pause a pool.
 * Run: `npx tsx src/modules/copy-trade/assert-kill-switch.ts`
 */
import assert from 'node:assert/strict';
import { isHaltedVault, vaultLoss } from './kill-switch.js';

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000);

// 1. Flow-neutral epochs: NAV jumps (deposit then withdraw) but share price flat.
{
  const epochs = [
    { navSol: 1.6, sharePrice: 1.02, createdAt: hoursAgo(30) },
    { navSol: 2.1, sharePrice: 1.02, createdAt: hoursAgo(2) },
    { navSol: 1.2, sharePrice: 1.02, createdAt: hoursAgo(1) },
  ];
  const loss = vaultLoss(epochs);
  assert.equal(loss.dayPct, 0, `expected 0%, got ${loss.dayPct}%`);
  assert.equal(loss.weekPct, 0);
  assert.equal(isHaltedVault('live', null, epochs).halted, false);
}

// 2. Real drawdown on share price still halts.
{
  const epochs = [
    { navSol: 100, sharePrice: 1.0, createdAt: hoursAgo(30) },
    { navSol: 94, sharePrice: 0.94, createdAt: hoursAgo(1) },
  ];
  const halt = isHaltedVault('live', null, epochs);
  assert.equal(halt.halted, true);
  assert.ok(halt.dayPct <= -5, `expected <= -5%, got ${halt.dayPct}%`);
}

// 3. Legacy epochs without sharePrice fall back to NAV (old behaviour).
{
  const epochs = [
    { navSol: 100, createdAt: hoursAgo(30) },
    { navSol: 90, createdAt: hoursAgo(1) },
  ];
  const halt = isHaltedVault('live', null, epochs);
  assert.equal(halt.halted, true);
  assert.equal(Math.round(halt.dayPct), -10);
}

// 4. Paused status still blocks regardless of math.
{
  assert.equal(isHaltedVault('paused', null, []).halted, true);
}

console.log('kill-switch asserts: ALL GREEN');
