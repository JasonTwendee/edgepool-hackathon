/**
 * Executable evidence for RugCheck client (Qualify input).
 * Run: `npx tsx src/common/rugcheck/assert-rugcheck.ts` (mocked fetch).
 */
import assert from 'node:assert/strict';
import { RugCheckService } from './rugcheck.service.js';
import type { FetchLike } from '../market/datastream.service.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status }) as unknown as Response;

const CLEAN = {
  mint: 'M1', score: 1, rugged: false, risks: [], topHolders: [{ pct: 4.2 }],
  totalMarketLiquidity: 900000,
};
const DIRTY = {
  mint: 'M2', score: 850, rugged: false,
  risks: [{ name: 'Single holder ownership' }, { name: 'Low liquidity' }],
  topHolders: [{ pct: 62 }],
};
const RUGGED = { mint: 'M3', score: 9999, rugged: true, risks: [{ name: 'Rugged' }] };

async function main(): Promise<void> {
  let calls = 0;
  const byMint: Record<string, unknown> = { M1: CLEAN, M2: DIRTY, M3: RUGGED };
  const f: FetchLike = (async (url: string) => {
    calls += 1;
    const mint = Object.keys(byMint).find((m) => url.includes(m)) ?? 'M1';
    return json(byMint[mint]);
  }) as unknown as FetchLike;

  const svc = new RugCheckService();
  const v1 = await svc.getReport('M1', f);
  assert.equal(v1.score, 1);
  assert.equal(v1.rugged, false);
  assert.deepEqual(v1.riskNames, []);
  assert.equal(v1.topHolderPct, 4.2);
  assert.equal(v1.liquidityUsd, 900000);
  // Cache: second call for same mint makes no fetch.
  await svc.getReport('M1', f);
  assert.equal(calls, 1);

  const q1 = await svc.qualify('M1', {}, f);
  assert.equal(q1.pass, true);
  const q2 = await svc.qualify('M2', {}, f);
  assert.equal(q2.pass, false);
  assert.ok(q2.reasons.join(' ').includes('Single holder'));
  const q2b = await svc.qualify('M2', { maxRisks: 5 }, f);
  assert.equal(q2b.pass, true);
  const q3 = await svc.qualify('M3', { maxRisks: 99 }, f);
  assert.equal(q3.pass, false); // rugged always blocks

  const ferr: FetchLike = (async () => json({}, 500)) as unknown as FetchLike;
  await assert.rejects(() => new RugCheckService().getReport('MX', ferr), /RugCheck 500/);

  console.log('rugcheck asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
