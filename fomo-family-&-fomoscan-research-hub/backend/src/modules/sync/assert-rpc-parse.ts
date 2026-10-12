/**
 * Executable evidence for the Helius-free signal pipeline: fresh signatures
 * Helius doesn't cover are classified by the pure-RPC parser, persisted as
 * BUY/SELL rows (source 'rpc-parser', final), and flow to auto-fire.
 * Parse failures still persist the minimal UNKNOWN row — classification
 * must never break ingestion.
 * Run: `npx tsx src/modules/sync/assert-rpc-parse.ts` (mocked, no network).
 */
import assert from 'node:assert/strict';
import { HistorySyncService } from './history-sync.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { EnrichService } from '../helius/enrich.service.js';

type Row = Record<string, unknown>;

const NOW = Math.floor(Date.now() / 1000);
const sig = (s: string, t = NOW - 60) => ({ signature: s, slot: 1, blockTime: t, err: null, memo: null });
const WALLET = { address: 'W1', label: 't1', handle: 't1', isCopyEnabled: true, allocationWeight: 1 };

const BUY = { action: 'BUY', symbol: '$ABCD', tokenMint: 'M1', amountToken: 100, amountUsd: 12.5, dexVenue: 'Jupiter Aggregator', status: 'SUCCESS', feeSol: 0.000005 };
const FAILED_BUY = { ...BUY, status: 'FAILED' };

function makeWorld(opts: {
  pages: Row[][];
  heliusPartials?: Map<string, Row>;
  parsed?: Map<string, Row | null | 'throw'>;
  preKnown?: string[];
}) {
  const created: Row[] = [];
  const parseCalls: string[] = [];
  const prisma = {
    transaction: {
      findMany: async () => (opts.preKnown ?? []).map((s) => ({ signature: s })),
      findFirst: async () => null,
      count: async () => created.length,
      create: async ({ data }: { data: Row }) => {
        created.push(data);
        return data;
      },
    },
    trackedWallet: { updateMany: async () => ({ count: 0 }) },
    realtimeEvent: {
      findFirst: async () => null,
      create: async () => ({ id: 1 }),
    },
  } as never;
  const txSvc = new TransactionsService(prisma);
  const realEnrich = new EnrichService({ isEnabled: () => false } as never);
  const heliusMap = opts.heliusPartials ?? new Map<string, Row>();
  const enrich = {
    enrichMany: async () => heliusMap,
    assembleEvent: realEnrich.assembleEvent.bind(realEnrich),
  } as never;
  let page = 0;
  const solana = {
    fetchSignatures: async () => opts.pages[page++] ?? [],
    emitLive: () => undefined,
  } as never;
  const rpcParse = {
    parse: async (s: string) => {
      parseCalls.push(s);
      const v = opts.parsed?.get(s);
      if (v === 'throw') throw new Error('RPC down');
      return (v ?? null) as never;
    },
  } as never;
  const svc = new HistorySyncService(solana, enrich, {} as never, txSvc, prisma, rpcParse);
  return { svc, created, parseCalls };
}

async function main(): Promise<void> {
  // 1. Helius dark: BUY parsed via RPC, null/throw stay UNKNOWN but persist.
  {
    const { svc, created, parseCalls } = makeWorld({
      pages: [[sig('sigA'), sig('sigB'), sig('sigC')]],
      parsed: new Map<string, Row | null | 'throw'>([['sigA', BUY], ['sigB', null], ['sigC', 'throw']]),
    });
    const r = await svc.syncWallet(WALLET as never);
    assert.equal(r.added, 3);
    const a = created.find((x) => x.signature === 'sigA')!;
    assert.equal(a.action, 'BUY');
    assert.equal(a.tokenMint, 'M1');
    assert.deepEqual(parseCalls.sort(), ['sigA', 'sigB', 'sigC']);
    const b = created.find((x) => x.signature === 'sigB')!;
    const c = created.find((x) => x.signature === 'sigC')!;
    assert.equal(b.action, 'UNKNOWN');
    assert.equal(c.action, 'UNKNOWN');
    // rpc-parser rows are final (heal skips them); bare rpc rows are not.
    assert.equal((a.rawPayload as Row).enriched, true);
    assert.equal((a.rawPayload as Row).eventSource, 'rpc-parser');
    assert.equal((b.rawPayload as Row).enriched, false);
  }

  // 2. Helius partial wins: parser is not even called for covered signatures.
  {
    const { svc, created, parseCalls } = makeWorld({
      pages: [[sig('sigH'), sig('sigR')]],
      heliusPartials: new Map([['sigH', { ...BUY, dexVenue: 'Pump.fun' }]]),
      parsed: new Map([['sigR', BUY]]),
    });
    await svc.syncWallet(WALLET as never);
    assert.deepEqual(parseCalls, ['sigR']);
    const h = created.find((x) => x.signature === 'sigH')!;
    assert.equal((h.rawPayload as Row).eventSource, 'helius');
    const r2 = created.find((x) => x.signature === 'sigR')!;
    assert.equal(r2.action, 'BUY');
  }

  // 3. FAILED parses and transfers never become signals.
  {
    const { svc, created } = makeWorld({
      pages: [[sig('sigF')]],
      parsed: new Map([['sigF', FAILED_BUY]]),
    });
    await svc.syncWallet(WALLET as never);
    assert.equal(created[0].action, 'UNKNOWN');
  }

  // 4. Budget: 40 fresh signatures → exactly 30 parses (loop never stalls).
  {
    const many = Array.from({ length: 40 }, (_, i) => sig(`sig${i}`));
    const { svc, parseCalls } = makeWorld({ pages: [many], parsed: new Map() });
    await svc.syncWallet(WALLET as never);
    assert.equal(parseCalls.length, 30);
  }

  console.log('rpc-parse asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
