/**
 * Solution v2 auto-pipeline (DRY-RUN ONLY — never broadcasts).
 * Pre-flight twin of AutoFireService (T1): same Detect → Qualify → Size flow,
 * but prints WOULD-FIRE instead of executing. Safe to run anytime for review.
 *
 * Run: `npx tsx src/modules/copy-trade/watch-signals.ts [--minutes=15]`
 */
import 'dotenv/config';
import { PrismaService } from '../../database/prisma.service.js';
import { DataStreamService } from '../../common/market/datastream.service.js';
import { RugCheckService } from '../../common/rugcheck/rugcheck.service.js';
import { VaultService } from '../vaults/vault.service.js';

const WSOL = 'So11111111111111111111111111111111111111112';

async function main(): Promise<void> {
  const mArg = process.argv.find((a) => a.startsWith('--minutes=')) ?? '--minutes=15';
  const minutes = Math.min(Math.max(parseInt(mArg.split('=')[1] || '15', 10), 1), 120);
  const prisma = new PrismaService();
  const ds = new DataStreamService();
  const rugs = new RugCheckService();
  const vaults = new VaultService(prisma);
  const since = new Date(Date.now() - minutes * 60000);

  const signals = await prisma.transaction.findMany({
    where: { action: 'BUY', createdAt: { gte: since }, NOT: [{ tokenMint: null }] },
    select: { signature: true, walletAddress: true, symbol: true, tokenMint: true, amountUsd: true, blockTime: true },
    orderBy: { blockTime: 'desc' },
    take: 30,
  });
  if (signals.length === 0) {
    console.log(`No master BUY signals in last ${minutes}m.`);
    await prisma.$disconnect();
    return;
  }
  // Vault sizing context (once).
  let capUsd = 100;
  try {
    const st = await vaults.status(1);
    const px = await ds.bulkPrices([WSOL]);
    if (st.lastEpoch && (px[WSOL] ?? 0) > 0) {
      capUsd = Math.min(100, st.lastEpoch.navSol * (px[WSOL] as number) * 0.01, 0.1 * (px[WSOL] as number));
    }
  } catch {
    // sizing falls back to flat cap
  }
  console.log(`signals: ${signals.length} | sized cap: $${capUsd.toFixed(2)}`);
  let fired = 0;
  for (const s of signals.slice(0, 10)) {
    const mint = s.tokenMint as string;
    let verdict = 'no-mint';
    try {
      const q = await rugs.qualify(mint);
      verdict = q.pass ? 'PASS' : `BLOCKED(${q.reasons.join('; ').slice(0, 80)})`;
    } catch (e) {
      verdict = `ERROR(${(e as Error).message.slice(0, 60)})`;
    }
    const masterUsd = s.amountUsd?.toNumber() ?? 0;
    const copyUsd = Math.round(Math.min(masterUsd || capUsd, capUsd) * 100) / 100;
    const fire = verdict === 'PASS';
    if (fire) fired++;
    console.log(
      `${fire ? 'WOULD-FIRE' : 'SKIP'} ${s.symbol ?? '?'} master=$${masterUsd} copy=$${copyUsd} qualify=${verdict}`,
    );
    await new Promise((r) => setTimeout(r, 300));
  }
  await prisma.$disconnect();
  console.log(`done: ${fired} would-fire (dry-run — auto-fire is OFF, no broadcasts, no writes)`);
}

void main().catch((e) => {
  console.error('WATCH FAILED:', (e as Error).message);
  process.exit(1);
});
