/**
 * Executable evidence for the Helius-free signal pipeline: fresh signatures
 * Helius doesn't cover are classified by the pure-RPC fallback
 * (TxParseService.classifyFresh), persisted as BUY/SELL rows (source
 * 'rpc-parser', final), and flow to auto-fire — on both the WS live path
 * (seconds-old sigs, inside the RPC body cache) and the safety-net sync.
 * Parse failures still persist the minimal UNKNOWN row — classification
 * must never break ingestion.
 * Run: `npx tsx src/modules/sync/assert-rpc-parse.ts` (mocked, no network).
 */
import assert from 'node:assert/strict';
import { HistorySyncService } from './history-sync.service.js';
import { OnchainService } from '../onchain/onchain.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { EnrichService } from '../helius/enrich.service.js';
import { TxParseService } from '../../common/chain/tx-parse.service.js';

type Row = Record<string, unknown>;

const NOW = Math.floor(Date.now() / 1000);
const sig = (s: string, t = NOW - 60) => ({ signature: s, slot: 1, blockTime: t, err: null, memo: null });
const WALLET = { address: 'W1', label: 't1', handle: 't1', isCopyEnabled: true, allocationWeight: 1 };

const BUY = { action: 'BUY', symbol: '$ABCD', tokenMint: 'M1', amountToken: 100, amountUsd: 12.5, dexVenue: 'Jupiter Aggregator', status: 'SUCCESS', feeSol: 0.000005 };
const FAILED_BUY = { ...BUY, status: 'FAILED' };
const TRANSFER = { action: 'TRANSFER', symbol: 'SOL', tokenMint: 'So11111111111111111111111111111111111111112', amountToken: 1, amountUsd: 150, dexVenue: 'Solana Native', status: 'SUCCESS', feeSol: 0.000005 };

function stubParser(script: Map<string, Row | null | 'throw'>, calls: string[]): TxParseService {
  const svc = new TxParseService({} as never);
  svc.parse = (async (s: string) => {
    calls.push(s);
    const v = script.get(s);
    if (v === 'throw') throw new Error('RPC down');
    return (v ?? null) as never;
  }) as never;
  return svc;
}

function makeTx(prisma: Row): { svc: TransactionsService; created: Row[] } {
  const created: Row[] = [];
  const db = {
    transaction: {
      findMany: async () => [],
      findFirst: async () => null,
      count: async () => created.length,
      create: async ({ data }: { data: Row }) => {
        if ((prisma.failOn as string | undefined) === data.signature) throw new Error('FK violation');
        created.push(data);
        return data;
      },
    },
    trackedWallet: { updateMany: async () => ({ count: 0 }) },
    realtimeEvent: { findFirst: async () => null, create: async () => ({ id: 1 }) },
  } as never;
  return { svc: new TransactionsService(db), created };
}

const realEnrich = () => {
  const e = new EnrichService({ isEnabled: () => false } as never, {} as never);
  return { enrichMany: async () => new Map(), assembleEvent: e.assembleEvent.bind(e) } as never;
};

async function main(): Promise<void> {
  // 1. classifyFresh filters: SUCCESS swaps with a mint pass; failures,
  // transfers and throws are skipped; budget caps the RPC calls.
  {
    const calls: string[] = [];
    const script = new Map<string, Row | null | 'throw'>([
      ['sBuy', BUY], ['sFail', FAILED_BUY], ['sXfer', TRANSFER], ['sNull', null], ['sThrow', 'throw'],
    ]);
    const parser = stubParser(script, calls);
    const out = await parser.classifyFresh('W1', [sig('sBuy'), sig('sFail'), sig('sXfer'), sig('sNull'), sig('sThrow'), sig('sCovered')], new Set(['sCovered']), 30);
    assert.deepEqual([...out.keys()], ['sBuy']);
    assert.deepEqual(calls.sort(), ['sBuy', 'sFail', 'sNull', 'sThrow', 'sXfer']);
    const many = Array.from({ length: 40 }, (_, i) => sig(`m${i}`));
    const calls2: string[] = [];
    const parser2 = stubParser(new Map(), calls2);
    await parser2.classifyFresh('W1', many, new Set(), 30);
    assert.equal(calls2.length, 30);
  }

  // 2. Safety-net sync: Helius dark → RPC BUY persisted as final; null/throw
  // persist as UNKNOWN (ingestion never breaks).
  {
    const calls: string[] = [];
    const parser = stubParser(new Map<string, Row | null | 'throw'>([['sigA', BUY], ['sigB', null], ['sigC', 'throw']]), calls);
    const { svc: txSvc, created } = makeTx({});
    const solana = { fetchSignatures: async () => [sig('sigA'), sig('sigB'), sig('sigC')], emitLive: () => undefined } as never;
    const prisma = { transaction: { findMany: async () => [] }, realtimeEvent: { findFirst: async () => null, create: async () => ({ id: 1 }) } } as never;
    const svc = new HistorySyncService(solana, realEnrich(), {} as never, txSvc, prisma, parser);
    const r = await svc.syncWallet(WALLET as never);
    assert.equal(r.added, 3);
    const a = created.find((x) => x.signature === 'sigA')!;
    assert.equal(a.action, 'BUY');
    assert.equal(a.tokenMint, 'M1');
    assert.equal((a.rawPayload as Row).enriched, true);
    assert.equal((a.rawPayload as Row).eventSource, 'rpc-parser');
    const b = created.find((x) => x.signature === 'sigB')!;
    assert.equal(b.action, 'UNKNOWN');
    assert.equal((b.rawPayload as Row).enriched, false);
  }

  // 3. Helius partial wins on the sync path: covered sigs never reach the parser.
  {
    const calls: string[] = [];
    const parser = stubParser(new Map<string, Row | null | 'throw'>([['sigR', BUY]]), calls);
    const { svc: txSvc, created } = makeTx({});
    const e = new EnrichService({ isEnabled: () => false } as never, {} as never);
    const enrich = {
      enrichMany: async () => new Map([['sigH', { ...BUY, dexVenue: 'Pump.fun' }]]),
      assembleEvent: e.assembleEvent.bind(e),
    } as never;
    const solana = { fetchSignatures: async () => [sig('sigH'), sig('sigR')], emitLive: () => undefined } as never;
    const prisma = { transaction: { findMany: async () => [] }, realtimeEvent: { findFirst: async () => null, create: async () => ({ id: 1 }) } } as never;
    const svc = new HistorySyncService(solana, enrich, {} as never, txSvc, prisma, parser);
    await svc.syncWallet(WALLET as never);
    assert.deepEqual(calls, ['sigR']);
    assert.equal((created.find((x) => x.signature === 'sigH')!.rawPayload as Row).eventSource, 'helius');
  }

  // 4. WS live path: RPC BUY recorded with rpc-parser source; one bad row
  // (FK) no longer kills the whole batch.
  {
    const calls: string[] = [];
    const parser = stubParser(new Map<string, Row | null | 'throw'>([['live1', BUY], ['live3', BUY]]), calls);
    const { svc: txSvc, created } = makeTx({ failOn: 'live2' });
    const solana = {
      getTrackedWallets: () => [WALLET],
      fetchSignatures: async () => [sig('live1'), sig('live2'), sig('live3')],
      emitLive: () => undefined,
    } as never;
    const stream = { setHandler: () => undefined } as never;
    const prisma = {
      trackedWallet: { findUnique: async () => ({ address: 'W1', isActive: true }) },
      realtimeEvent: { findFirst: async () => null, create: async () => ({ id: 1 }) },
    } as never;
    const svc = new OnchainService(solana, stream, realEnrich(), txSvc, prisma, parser);
    await svc.ingestWalletActivity('W1');
    assert.deepEqual(calls.sort(), ['live1', 'live2', 'live3']);
    assert.deepEqual(created.map((x) => x.signature).sort(), ['live1', 'live3']);
    assert.equal((created[0].rawPayload as Row).eventSource, 'rpc-parser');
  }

  // 5. Scope gate: Helius spend happens only for active trader-set wallets;
  // off-scope wallets return empty (RPC fallback covers them for free).
  {
    const parseCalls: string[] = [];
    const heliusFake = {
      isEnabled: () => true,
      parseTransactions: async (sigs: string[]) => {
        parseCalls.push(...sigs);
        return new Map();
      },
      getWsolMint: () => 'W',
      getTokenMeta: async () => null,
    };
    const prismaFake = { vaultTrader: { findMany: async () => [{ wallet: 'IN_SCOPE' }] } };
    const svc = new EnrichService(heliusFake as never, prismaFake as never);
    assert.equal((await svc.enrichMany('IN_SCOPE', [sig('a'), sig('b')])).size, 0);
    assert.deepEqual(parseCalls, ['a', 'b']);
    assert.equal((await svc.enrichMany('OUT', [sig('c')])).size, 0);
    assert.deepEqual(parseCalls, ['a', 'b']); // no Helius spent off-scope
    assert.deepEqual([...(await svc.poolScope())], ['IN_SCOPE']);
  }

  console.log('rpc-parse asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
