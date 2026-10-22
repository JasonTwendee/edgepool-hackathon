/**
 * Executable evidence for P2 (chain module). Pure asserts: no network, no DB.
 * Run: `npx tsx src/modules/chain/assert-chain.ts` from `backend/`.
 */
import assert from 'node:assert/strict';
import {
  computeMarksLamports,
  eventKey,
  eventNumber,
  isFaucetAllowed,
  isKnownKind,
  matchDepositByAmount,
  normalizeEventKind,
  parseChainEvents,
} from './events.js';
import { checkReconcile } from './reconcile.js';

const PID = '5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ';
const SIG = 'x'.repeat(88);

function stubDecode(b64: string): { kind: string; payload: Record<string, unknown> } | null {
  if (b64 === 'THROW') throw new Error('bad payload');
  if (b64 === 'UNKNOWN_KIND') return { kind: 'Nope', payload: {} };
  if (b64 === 'DEPOSIT') return { kind: 'DepositEvent', payload: { user: 'u1', amount_lamports: 1_000_000_000 } };
  if (b64 === 'EPOCH') return { kind: 'EpochSettled', payload: { price_scaled: 1_010_000_000 } };
  if (b64 === 'CAMEL') return { kind: 'markEvent', payload: { marksLamports: 42 } };
  return null;
}

// 1. Log parsing: invoke blocks, unknown kinds, decode throws.
{
  const logs = [
    'Program 11111111111111111111111111111111 invoke [1]',
    'Program data: DEPOSIT',
    `Program ${PID} invoke [1]`,
    'Program data: DEPOSIT',
    'Program data: UNKNOWN_KIND',
    'Program data: THROW',
    'Program data: EPOCH',
    'Program data: GARBAGE-NOT-IN-MAP',
  ];
  const evs = parseChainEvents(SIG, 100, logs, PID, stubDecode);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].kind, 'DepositEvent');
  assert.equal(evs[0].ixIndex, 0);
  assert.equal(evs[0].eventIndex, 0);
  assert.equal(evs[1].kind, 'EpochSettled');
  assert.equal(evs[1].eventIndex, 1);
  assert.ok(isKnownKind('PausedEvent'));
  assert.ok(isKnownKind('markEvent'));
  assert.ok(!isKnownKind('Nope'));
}

// 1b. Anchor camelCase → PascalCase; numeric fields support both casings.
{
  assert.equal(normalizeEventKind('markEvent'), 'MarkEvent');
  assert.equal(normalizeEventKind('DepositEvent'), 'DepositEvent');
  assert.equal(eventNumber({ marksLamports: 42 }, 'marksLamports', 'marks_lamports'), 42);
  assert.equal(eventNumber({ price_scaled: 7 }, 'priceScaled', 'price_scaled'), 7);
  assert.equal(eventNumber({}, 'amountLamports', 'amount_lamports'), 0);
  const logs = [`Program ${PID} invoke [1]`, 'Program data: CAMEL'];
  const evs = parseChainEvents(SIG, 101, logs, PID, stubDecode);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'MarkEvent');
  assert.equal(evs[0].payload.marksLamports, 42);
}

// 2. Idempotency: same event twice → same key (upsert collapses to 1 row).
{
  const e = { signature: SIG, ixIndex: 0, eventIndex: 0 };
  const store = new Map<string, number>();
  for (let i = 0; i < 2; i++) store.set(eventKey(e), (store.get(eventKey(e)) ?? 0) + 0);
  store.set(eventKey(e), 1);
  assert.equal(store.size, 1);
}

// 3. Deposit mirror matching: exact amount first, else oldest, else null.
{
  const rows = [
    { id: 1, amountSol: 2 },
    { id: 2, amountSol: 1 },
  ];
  assert.equal(matchDepositByAmount(rows, 1_000_000_000)?.id, 2);
  assert.equal(matchDepositByAmount(rows, 9_999)?.id, 1);
  assert.equal(matchDepositByAmount([], 1_000_000_000), null);
}

// 4. Marks math: floor, skip dust/negative/NaN.
{
  assert.equal(computeMarksLamports([1.5, 0.25]), 1_750_000_000);
  assert.equal(computeMarksLamports([0, -3, Number.NaN]), 0);
  assert.equal(computeMarksLamports([]), 0);
}

// 5. Faucet gate.
{
  assert.equal(isFaucetAllowed('devnet', true), true);
  assert.equal(isFaucetAllowed('mainnet', true), false);
  assert.equal(isFaucetAllowed('devnet', false), false);
}

// 6. Reconcile: green + each of the 5 checks fires alone.
{
  const on = { supplyRaw: 1_000_000_000, hwmScaled: 1_000_000_000, priceScaled: 1_010_000_000, treasuryCash: 500, feeCredit: 0 };
  const off = {
    supplyRaw: 1_000_000_000,
    hwmScaled: 1_000_000_000,
    lastPriceScaled: 1_010_000_000,
    obligations: 100,
    treasuryCash: 500,
    referencedSigs: ['a'],
    storedSigs: ['a'],
  };
  assert.deepEqual(checkReconcile(on, off), []);
  assert.equal(checkReconcile({ ...on, supplyRaw: 0 }, off)[0].check, 'supply-mirror');
  assert.equal(checkReconcile(on, { ...off, obligations: 9999 })[0].check, 'cash-coverage');
  assert.equal(checkReconcile(on, { ...off, lastPriceScaled: 0 })[0].check, 'price-mirror');
  assert.equal(checkReconcile(on, { ...off, referencedSigs: ['a', 'b'] })[0].check, 'event-completeness');
  assert.equal(checkReconcile(on, { ...off, hwmScaled: on.hwmScaled + 1 })[0].check, 'hwm-monotonic');
}

console.log('chain asserts: ALL GREEN');
