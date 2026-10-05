/**
 * Solution v2 (B1): shadow momentum validator — offline backtest, no chain.
 * Question: after a master BUY fill, does price reach +10% within 30 min
 * (the deck's momentum branch), and what is the adverse excursion first?
 *
 * Method: sample recent priced BUY swaps with tokenMint from the DB ledger,
 * pull 1m candles around each signal via DataStream, simulate. Writes a
 * markdown report (no business-table writes).
 *
 * Run: `npx tsx src/modules/copy-trade/shadow-momentum.ts [--selftest] [--n=50]`
 */
import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PrismaService } from '../../database/prisma.service.js';
import { DataStreamService, type Candle } from '../../common/market/datastream.service.js';

export interface SimResult {
  sigla: string;
  hitPlus10: boolean;
  minutesToHit: number | null;
  maxAdversePct: number;
  hitMinus10: boolean;
}

/** Simulate one signal against ordered candles (signal at index 0 boundary). */
export function simulate(
  signalPrice: number,
  signalTime: number,
  candles: Candle[],
  windowSec = 1800,
): SimResult | null {
  if (!(signalPrice > 0)) return null;
  const after = candles.filter((c) => c.timestamp >= signalTime).slice(0, 240);
  if (after.length === 0) return null;
  let worst = 0;
  let hitAt: number | null = null;
  let pullback = false;
  for (const c of after) {
    if (c.timestamp - signalTime > windowSec) break;
    const hi = ((c.high - signalPrice) / signalPrice) * 100;
    const lo = ((c.low - signalPrice) / signalPrice) * 100;
    if (lo < worst) worst = lo;
    if (lo <= -10) pullback = true;
    if (hitAt === null && hi >= 10) hitAt = c.timestamp;
  }
  return {
    sigla: '',
    hitPlus10: hitAt !== null,
    minutesToHit: hitAt === null ? null : Math.round(((hitAt - signalTime) / 60) * 10) / 10,
    maxAdversePct: Math.round(worst * 100) / 100,
    hitMinus10: pullback,
  };
}

function selftest(): void {
  const t0 = 1_000_000;
  const mk = (dt: number, hi: number, lo: number): Candle => ({
    open: 100, high: 100 + hi, low: 100 + lo, close: 100, volume: 1, timestamp: t0 + dt,
  });
  // Hits +10% at minute 5 after dipping -3%.
  const r1 = simulate(100, t0, [mk(0, 2, -1), mk(300, 12, -3), mk(600, 15, 5)])!;
  assert.equal(r1.hitPlus10, true);
  assert.equal(r1.minutesToHit, 5);
  assert.equal(r1.maxAdversePct, -3);
  // Never reaches +10%, dips -12% → pullback branch territory.
  const r2 = simulate(100, t0, [mk(0, 2, -1), mk(300, 5, -12), mk(3600, 4, -2)])!;
  assert.equal(r2.hitPlus10, false);
  assert.equal(r2.hitMinus10, true);
  assert.equal(simulate(0, t0, [mk(0, 1, 0)]), null);
  console.log('shadow-momentum selftest: GREEN');
}

async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    selftest();
    return;
  }
  const nArg = process.argv.find((a) => a.startsWith('--n=')) ?? '--n=50';
  const N = Math.min(Math.max(parseInt(nArg.split('=')[1] || '50', 10), 1), 200);
  const prisma = new PrismaService();
  const ds = new DataStreamService();
  const signals = await prisma.transaction.findMany({
    where: { action: 'BUY', NOT: [{ tokenMint: null }] },
    select: { signature: true, symbol: true, tokenMint: true, amountToken: true, amountUsd: true, blockTime: true },
    orderBy: { blockTime: 'desc' },
    take: N * 3,
  });
  // Keep priced rows with sane unit prices; dedupe per mint+hour candle window.
  const picked: typeof signals = [];
  const seen = new Set<string>();
  for (const s of signals) {
    const qty = s.amountToken?.toNumber() ?? 0;
    const usd = s.amountUsd?.toNumber() ?? 0;
    if (!(qty > 0) || !(usd > 0) || !s.tokenMint) continue;
    const unit = usd / qty;
    if (!(unit > 0)) continue;
    const key = `${s.tokenMint}:${Math.floor(Number(s.blockTime) / 3600)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(s);
    if (picked.length >= N) break;
  }
  console.log(`signals sampled: ${picked.length}`);
  const results: (SimResult & { symbol: string })[] = [];
  const cache = new Map<string, Candle[]>();
  for (const s of picked) {
    const t = Number(s.blockTime);
    const key = `${s.tokenMint}:${Math.floor(t / 3600)}`;
    let candles = cache.get(key);
    if (!candles) {
      try {
        candles = await ds.candles(s.tokenMint as string, { interval: '1', from: t - 120, to: t + 1900, count: 120 });
      } catch (e) {
        console.log(`  candles failed ${(s.symbol ?? '?')}: ${(e as Error).message}`);
        continue;
      }
      cache.set(key, candles);
      await new Promise((r) => setTimeout(r, 300));
    }
    const unit = (s.amountUsd as unknown as { toNumber(): number }).toNumber() / (s.amountToken as unknown as { toNumber(): number }).toNumber();
    const sim = simulate(unit, t, candles);
    if (sim) results.push({ ...sim, symbol: s.symbol });
  }
  await prisma.$disconnect();
  const hits = results.filter((r) => r.hitPlus10);
  const hitRate = results.length > 0 ? (hits.length / results.length) * 100 : 0;
  const tths = hits.map((r) => r.minutesToHit as number).sort((a, b) => a - b);
  const medianTth = tths.length > 0 ? tths[Math.floor(tths.length / 2)] : null;
  const maes = results.map((r) => r.maxAdversePct).sort((a, b) => a - b);
  const medianMae = maes.length > 0 ? maes[Math.floor(maes.length / 2)] : null;
  const pullbacks = results.filter((r) => r.hitMinus10).length;
  const lines = [
    `# Shadow momentum report — ${new Date().toISOString()}`,
    ``,
    `Sampled ${results.length} priced BUY signals (tokenMint present, 30d ledger).`,
    `Rule tested: entry counts if price reaches +10% above signal fill within 30 min.`,
    ``,
    `- Hit rate +10%/30m: **${hitRate.toFixed(1)}%** (${hits.length}/${results.length})`,
    `- Median minutes to +10%: ${medianTth === null ? '—' : medianTth}`,
    `- Median max adverse excursion: ${medianMae === null ? '—' : medianMae + '%'}`,
    `- Signals touching −10% first/in-window: ${pullbacks}/${results.length}`,
    ``,
    `Reading: hit rate below ~50% means the +10% momentum branch buys tops more`,
    `often than continuations on current data — prefer immediate-entry + TP ladder`,
    `from our own fill, or tighten the branch (e.g. +6% / 15 min) and re-run.`,
  ];
  const md = lines.join('\n');
  console.log(md);
  const outDir = '/home/jason/Downloads/twendee/hackathon-solana/fomo-family-&-fomoscan-research-hub/docs/codexminimal/shadow';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/shadow-momentum-${Date.now()}.md`, md);
}

void main().catch((e) => {
  console.error('SHADOW FAILED:', (e as Error).message);
  process.exit(1);
});
