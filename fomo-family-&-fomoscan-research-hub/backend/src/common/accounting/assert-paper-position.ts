import assert from 'node:assert/strict';
import { paperPositionPnl, remainingNotionalUsd } from './paper-position.js';

const position = { amountUsd: 100, entryPriceUsd: 10, realizedPnlUsd: 30, legs: [{ fraction: 0.5, realizedPnlUsd: 30 }] };
assert.equal(remainingNotionalUsd(position), 50);
assert.equal(paperPositionPnl(position, 14).realizedUsd, 30);
assert.ok(Math.abs(paperPositionPnl(position, 14).unrealizedUsd - 20) < 1e-9);
assert.deepEqual(paperPositionPnl({ ...position, closedAt: new Date() }), { realizedUsd: 30, unrealizedUsd: 0 });
assert.deepEqual(paperPositionPnl({ ...position, legs: undefined, closedAt: new Date() }), { realizedUsd: 30, unrealizedUsd: 0 });
assert.ok(Math.abs(paperPositionPnl({ ...position, action: 'SELL' }, 14).unrealizedUsd + 20) < 1e-9);
assert.throws(() => paperPositionPnl(position), /cannot be valued/);
assert.throws(() => paperPositionPnl(position, Number.NaN), /cannot be valued/);
assert.throws(() => paperPositionPnl({ ...position, entryPriceUsd: 0 }, 14), /cannot be valued/);
console.log('paper-position asserts: ALL GREEN');
