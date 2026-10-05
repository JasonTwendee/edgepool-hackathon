/**
 * Solution v2 (A2): manipulation flag job — pure DB, no chain.
 * Pattern per (wallet, symbol, 30d): BUY → pump ≥20% → SELL ≥50% of bought qty
 * ("signal dump"). ≥2 events → suspect. Default dry-run (prints only);
 * `--write` appends FLAG to TrackedWallet.ownerNotes for human review.
 * Never auto-disables wallets.
 *
 * Run: `npx tsx src/modules/copy-trade/flag-manipulation.ts [--write]`
 */
import { PrismaService } from '../../database/prisma.service.js';

export interface DumpTrade {
  action: string;
  symbol: string;
  amountToken: number | null;
  amountUsd: number | null;
  blockTime: number;
}

export interface DumpEvent {
  symbol: string;
  buyQty: number;
  avgBuyPrice: number;
  sellQty: number;
  sellPrice: number;
  pumpPct: number;
}

const PUMP_PCT = 20;
const DUMP_QTY_RATIO = 0.5;
const MIN_DUMPS = 2;
const WINDOW_DAYS = 30;
/** Noise guards: heuristic ledger misattributes dust/counter-legs. */
const STABLES = new Set(['$USDC', 'USDC', '$USDT', 'USDT', 'USD', '$USD']);
const MIN_NOTIONAL_USD = 20;
const MAX_PUMP_PCT = 5000;
/** Manipulators dump fast (into followers' buying); investors hold longer. */
const MAX_BASIS_AGE_SEC = 2 * 3600;

/** Detect pump-then-dump round trips in a time-ordered trade list. */
export function detectDumps(trades: DumpTrade[]): DumpEvent[] {
  const bySymbol = new Map<string, DumpTrade[]>();
  for (const t of [...trades].sort((a, b) => a.blockTime - b.blockTime)) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }
  const events: DumpEvent[] = [];
  for (const [symbol, list] of bySymbol) {
    if (STABLES.has(symbol)) continue;
    let buyQty = 0;
    let buyNotional = 0;
    let soldQty = 0;
    let basisStart = 0;
    const buys: { qty: number; price: number }[] = [];
    for (const t of list) {
      const qty = t.amountToken ?? 0;
      const price =
        qty > 0 && (t.amountUsd ?? 0) > 0 ? (t.amountUsd as number) / qty : 0;
      if (t.action === 'BUY' && qty > 0 && price > 0) {
        if (buyQty === 0) basisStart = t.blockTime;
        buyQty += qty;
        buyNotional += qty * price;
        buys.push({ qty, price });
      } else if (t.action === 'SELL' && qty > 0 && price > 0 && buyQty > 0) {
        const avgBuy = buyNotional / buyQty;
        const pumpPct = ((price - avgBuy) / avgBuy) * 100;
        const sellNotional = qty * price;
        soldQty += qty;
        if (
          pumpPct >= PUMP_PCT &&
          pumpPct <= MAX_PUMP_PCT &&
          buyNotional >= MIN_NOTIONAL_USD &&
          sellNotional >= MIN_NOTIONAL_USD &&
          soldQty >= buyQty * DUMP_QTY_RATIO &&
          t.blockTime - basisStart <= MAX_BASIS_AGE_SEC
        ) {
          events.push({ symbol, buyQty, avgBuyPrice: avgBuy, sellQty: qty, sellPrice: price, pumpPct });
          // Reset cost basis after a counted dump (one event per round trip).
          buyQty = 0;
          buyNotional = 0;
          soldQty = 0;
          buys.length = 0;
        }
      }
    }
    void buys;
  }
  return events;
}

function selftest(): void {
  const t0 = 1_700_000_000;
  // Classic dump: buy 100 @1, sell 60 @1.5 (+50%) → event.
  const dump: DumpTrade[] = [
    { action: 'BUY', symbol: 'X', amountToken: 100, amountUsd: 100, blockTime: t0 },
    { action: 'SELL', symbol: 'X', amountToken: 60, amountUsd: 90, blockTime: t0 + 60 },
  ];
  const r1 = detectDumps(dump);
  if (r1.length !== 1 || Math.round(r1[0].pumpPct) !== 50) throw new Error('dump case failed');
  // Honest exit: sell small below pump threshold → no event.
  const honest: DumpTrade[] = [
    { action: 'BUY', symbol: 'Y', amountToken: 100, amountUsd: 100, blockTime: t0 },
    { action: 'SELL', symbol: 'Y', amountToken: 10, amountUsd: 11, blockTime: t0 + 60 },
  ];
  if (detectDumps(honest).length !== 0) throw new Error('honest case failed');
  // Unpriced rows are skipped, not crashed on.
  const unpriced: DumpTrade[] = [
    { action: 'BUY', symbol: 'Z', amountToken: null, amountUsd: null, blockTime: t0 },
    { action: 'SELL', symbol: 'Z', amountToken: 5, amountUsd: null, blockTime: t0 + 60 },
  ];
  if (detectDumps(unpriced).length !== 0) throw new Error('unpriced case failed');
  console.log('flag-manipulation selftest: GREEN');
}

async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    selftest();
    return;
  }
  const write = process.argv.includes('--write');
  const prisma = new PrismaService();
  const since = BigInt(Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400);
  const wallets = await prisma.trackedWallet.findMany({ orderBy: { id: 'asc' } });
  const suspects: { wallet: string; label: string; dumps: number; symbols: string[] }[] = [];
  for (const w of wallets) {
    const rows = await prisma.transaction.findMany({
      where: { walletAddress: w.address, blockTime: { gte: since } },
      select: { action: true, symbol: true, amountToken: true, amountUsd: true, blockTime: true },
      orderBy: { blockTime: 'asc' },
    });
    const trades: DumpTrade[] = rows.map((r) => ({
      action: r.action,
      symbol: r.symbol,
      amountToken: r.amountToken?.toNumber() ?? null,
      amountUsd: r.amountUsd?.toNumber() ?? null,
      blockTime: Number(r.blockTime),
    }));
    const events = detectDumps(trades);
    if (events.length >= MIN_DUMPS) {
      const symbols = [...new Set(events.map((e) => e.symbol))];
      suspects.push({ wallet: w.address, label: w.label, dumps: events.length, symbols });
      console.log(`SUSPECT ${w.label} (${w.address.slice(0, 8)}…): ${events.length} dumps [${symbols.join(',')}]`);
      for (const e of events.slice(0, 5)) {
        console.log(
          `  ${e.symbol}: bought ${e.buyQty.toFixed(1)} @${e.avgBuyPrice.toFixed(4)} → sold ${e.sellQty.toFixed(1)} @${e.sellPrice.toFixed(4)} (+${e.pumpPct.toFixed(1)}%)`,
        );
      }
      if (write) {
        const tag = `FLAG:suspected-signal-dump:${events.length}`;
        const notes = w.ownerNotes?.includes('FLAG:suspected-signal-dump')
          ? w.ownerNotes
          : [w.ownerNotes, tag].filter(Boolean).join(' | ');
        await prisma.trackedWallet.update({ where: { address: w.address }, data: { ownerNotes: notes } });
        console.log(`  → notes updated`);
      }
    }
  }
  await prisma.$disconnect();
  if (suspects.length === 0) console.log('No suspects (dry-run, no writes).');
  else if (!write) console.log(`\n${suspects.length} suspect(s) — dry-run, no writes. Re-run with --write to tag notes.`);
}

void main().catch((e) => {
  console.error('FLAG JOB FAILED:', (e as Error).message);
  process.exit(1);
});
