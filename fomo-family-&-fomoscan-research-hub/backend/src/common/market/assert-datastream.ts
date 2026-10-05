/**
 * Executable evidence for DataStream client + ATR/stop math.
 * Run: `npx tsx src/common/market/assert-datastream.ts` (mocked fetch).
 */
import assert from 'node:assert/strict';
import { DataStreamService, type FetchLike } from './datastream.service.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status }) as unknown as Response;

async function main(): Promise<void> {
  const svc = new DataStreamService().configure('https://x.test', '');

  // bulkPrices: parses map, drops non-positive/non-numeric.
  const f1: FetchLike = (async () =>
    json({ data: { M1: 1.5, M2: 0, M3: 'x', M4: -2 } })) as unknown as FetchLike;
  assert.deepEqual(await svc.bulkPrices(['M1', 'M2', 'M3', 'M4'], f1), { M1: 1.5 });

  // bulkPrices: empty in → no fetch.
  let called = 0;
  const f0: FetchLike = (async () => {
    called += 1;
    return json({});
  }) as unknown as FetchLike;
  assert.deepEqual(await svc.bulkPrices([], f0), {});
  assert.equal(called, 0);

  // bulkPrices: HTTP error → throws.
  const ferr: FetchLike = (async () => json({}, 503)) as unknown as FetchLike;
  await assert.rejects(() => svc.bulkPrices(['M1'], ferr), /DataStream 503/);

  // candles: filters malformed rows.
  const fc: FetchLike = (async () =>
    json([
      { open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 10, timestamp: 1 },
      { open: 'x', high: 1, low: 1, close: 1 },
      null,
    ])) as unknown as FetchLike;
  const candles = await svc.candles('MINT', { interval: '1H', count: 5 }, fc);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].close, 1.05);

  // ATR math: flat series → tiny fraction; insufficient data → null.
  const flat = Array.from({ length: 20 }, (_, i) => ({
    open: 100, high: 100.5, low: 99.5, close: 100, volume: 1, timestamp: i,
  }));
  const f = DataStreamService.atrFraction(flat)!;
  assert.ok(f > 0 && f < 0.02, `atr=${f}`);
  assert.equal(DataStreamService.atrFraction(flat.slice(0, 5)), null);
  // Stop suggestion clamps to [8, 40].
  assert.equal(DataStreamService.suggestStopPct(flat), 8);
  const wild = Array.from({ length: 20 }, (_, i) => ({
    open: 100, high: 150, low: 50, close: 100, volume: 1, timestamp: i,
  }));
  assert.equal(DataStreamService.suggestStopPct(wild), 40);
  assert.equal(DataStreamService.suggestStopPct([]), null);

  // Regime: calm series → floor stop, RR 1:2 TP1, trail floor.
  const calmSeries = Array.from({ length: 20 }, (_, i) => ({
    open: 100, high: 100.2, low: 99.8, close: 100, volume: 1, timestamp: i,
  }));
  const calm = DataStreamService.suggestRegime(calmSeries)!;
  assert.equal(calm.regime, 'calm');
  assert.equal(calm.stopPct, 8);
  assert.equal(calm.tp1Pct, 20);
  assert.equal(calm.trailPct, 10);
  // Regime: wild series → capped stop, scaled TP1/trail.
  const wildRegime = DataStreamService.suggestRegime(wild)!;
  assert.equal(wildRegime.regime, 'wild');
  assert.equal(wildRegime.stopPct, 40);
  assert.equal(wildRegime.tp1Pct, 80);
  assert.equal(wildRegime.trailPct, 30);
  // Regime: mid volatility → normal band.
  const mid = Array.from({ length: 20 }, (_, i) => ({
    open: 100, high: 101, low: 99, close: 100, volume: 1, timestamp: i,
  }));
  const midRegime = DataStreamService.suggestRegime(mid)!;
  assert.equal(midRegime.regime, 'normal');
  assert.equal(midRegime.stopPct, 8);
  assert.equal(midRegime.tp1Pct, 20);
  // No data → null (caller falls back to fixed defaults).
  assert.equal(DataStreamService.suggestRegime([]), null);
  assert.equal(DataStreamService.suggestRegime(flat.slice(0, 5)), null);

  console.log('datastream asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
