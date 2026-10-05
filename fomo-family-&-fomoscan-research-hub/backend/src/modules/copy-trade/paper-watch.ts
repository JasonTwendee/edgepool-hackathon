/**
 * Solution v2 (A3): paper watch — alert-only, no chain writes, no auto-halt.
 * 1. Time-stop: CONFIRMED paper orders older than 24h (no TP engine yet, so
 *    these need human review instead of auto-exit).
 * 2. Kill-switch stats: 24h paper activity (counts + notional + FAILED rate)
 *    plus vault devnet SOL balance. Flags REVIEW when FAILED is elevated.
 * Prints a report; exit 0 always (alerts, not gates).
 *
 * Run: `npx tsx src/modules/copy-trade/paper-watch.ts`
 */
import 'dotenv/config';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrismaService } from '../../database/prisma.service.js';

const TIME_STOP_HOURS = 24;
const FAIL_REVIEW_THRESHOLD = 3;

async function main(): Promise<void> {
  const prisma = new PrismaService();
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600 * 1000);

  // 1. Stale CONFIRMED orders (time-stop candidates).
  const stale = await prisma.copyOrder.findMany({
    where: { status: 'CONFIRMED', createdAt: { lt: new Date(now - TIME_STOP_HOURS * 3600 * 1000) } },
    select: { id: true, symbol: true, masterHandle: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  console.log(`--- time-stop review (CONFIRMED older than ${TIME_STOP_HOURS}h): ${stale.length} ---`);
  for (const o of stale.slice(0, 10)) {
    console.log(`  #${o.id} ${o.masterHandle ?? '?'} ${o.symbol ?? '?'} opened ${o.createdAt.toISOString()}`);
  }

  // 2. 24h paper stats.
  const recent = await prisma.copyOrder.findMany({
    where: { createdAt: { gte: dayAgo } },
    select: { status: true, amountUsd: true },
  });
  const byStatus = new Map<string, number>();
  let notional = 0;
  for (const r of recent) {
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    notional += r.amountUsd?.toNumber() ?? 0;
  }
  const failed = byStatus.get('FAILED') ?? 0;
  console.log(`--- 24h paper: ${recent.length} orders, notional $${notional.toFixed(2)} ---`);
  for (const [s, n] of byStatus) console.log(`  ${s}: ${n}`);
  if (failed >= FAIL_REVIEW_THRESHOLD) {
    console.log(`REVIEW: ${failed} FAILED in 24h (>= ${FAIL_REVIEW_THRESHOLD}) — check RPC/quote/vault before continuing.`);
  }

  // 3. Vault devnet balance (read-only; pubkey is public, secret never printed).
  try {
    const { Keypair } = await import('@solana/web3.js');
    const raw = (process.env.VAULT_PRIVATE_KEY ?? '').trim();
    if (!raw) {
      console.log('vault: no VAULT_PRIVATE_KEY set');
    } else {
      const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
      const pubkey = Keypair.fromSecretKey(bytes).publicKey;
      const conn = new Connection(process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
      const lamports = await conn.getBalance(pubkey);
      console.log(`vault ${pubkey.toBase58()}: ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} devnet SOL`);
    }
  } catch (e) {
    console.log(`vault check failed: ${(e as Error).message}`);
  }
  await prisma.$disconnect();
  console.log('paper-watch: DONE (alerts only, no state changed)');
}

void main().catch((e) => {
  console.error('WATCH FAILED:', (e as Error).message);
  process.exit(1);
});
