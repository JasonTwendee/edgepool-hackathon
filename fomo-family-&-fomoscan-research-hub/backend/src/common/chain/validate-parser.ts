/**
 * Parity validator: pure-RPC parser vs Helius-enriched DB rows.
 * Compares action + venue + tokenMint + amountToken on recent swaps.
 * CONSTRAINT (found 2026-10-02): FluxRPC tier keeps ~70s of tx history
 * (oldestSlot ≈ current − 174), so only rows fresher than ~2 minutes are
 * testable — older rows skip with "not available in cache". No writes.
 *
 * Run: `npx tsx src/common/chain/validate-parser.ts [--n=30]`
 */
import 'dotenv/config';
import { TxParseService } from './tx-parse.service.js';
import { DataStreamService } from '../market/datastream.service.js';
import { PrismaService } from '../../database/prisma.service.js';

async function main(): Promise<void> {
  const nArg = process.argv.find((a) => a.startsWith('--n=')) ?? '--n=30';
  const N = Math.min(Math.max(parseInt(nArg.split('=')[1] || '30', 10), 1), 100);
  const prisma = new PrismaService();
  const parser = new TxParseService(new DataStreamService());
  const rows = await prisma.transaction.findMany({
    where: { action: { in: ['BUY', 'SELL'] } },
    select: { signature: true, walletAddress: true, action: true, symbol: true, tokenMint: true, amountToken: true, dexVenue: true },
    orderBy: { blockTime: 'desc' },
    take: N,
  });
  let compared = 0;
  let actionOk = 0;
  let venueOk = 0;
  let mintOk = 0;
  let qtyOk = 0;
  for (const r of rows) {
    let parsed = null;
    try {
      parsed = await parser.parse(r.signature, r.walletAddress);
    } catch (e) {
      console.log(`  skip ${r.signature.slice(0, 8)}…: ${(e as Error).message.slice(0, 80)}`);
      continue;
    }
    if (!parsed) {
      console.log(`  null ${r.signature.slice(0, 8)}… (db: ${r.action} ${r.symbol})`);
      continue;
    }
    compared++;
    const dbQty = r.amountToken?.toNumber() ?? 0;
    if (parsed.action === r.action) actionOk++;
    else console.log(`  ACTION ${r.signature.slice(0, 8)}… db=${r.action} parsed=${parsed.action} (${r.symbol})`);
    if (parsed.dexVenue === r.dexVenue) venueOk++;
    if ((parsed.tokenMint ?? null) === r.tokenMint) mintOk++;
    if (parsed.amountToken !== undefined && dbQty > 0) {
      const rel = Math.abs(parsed.amountToken - dbQty) / dbQty;
      if (rel <= 0.05) qtyOk++;
      else console.log(`  QTY ${r.signature.slice(0, 8)}… db=${dbQty} parsed=${parsed.amountToken}`);
    }
    await new Promise((x) => setTimeout(x, 300));
  }
  await prisma.$disconnect();
  const pct = (v: number): string => (compared > 0 ? ((v / compared) * 100).toFixed(1) + '%' : '—');
  console.log(`parity over ${compared}/${rows.length}: action ${pct(actionOk)}, venue ${pct(venueOk)}, mint ${pct(mintOk)}, qty±5% ${pct(qtyOk)}`);
}

void main().catch((e) => {
  console.error('VALIDATE FAILED:', (e as Error).message);
  process.exit(1);
});
