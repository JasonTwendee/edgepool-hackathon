/**
 * Executable evidence for P2 (paper executor + orchestration).
 * Run: `npx tsx src/modules/copy-trade/assert-paper-executor.ts`
 * All IO is mocked — no network, no DB, no key required.
 */
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import {
  DEVNET_GENESIS_HASH,
  PaperExecutorService,
} from './paper-executor.service.js';
import { CopyTradeService } from './copy-trade.service.js';

const DEVNET_CONN = { getGenesisHash: async () => DEVNET_GENESIS_HASH } as never;
const MAINNET_CONN = { getGenesisHash: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2R9' } as never;

async function main(): Promise<void> {
  const executor = new PaperExecutorService();

  // 1. Devnet gate: mainnet refused, devnet passes.
  await assert.rejects(() => executor.assertDevnet(MAINNET_CONN), /devnet/i);
  await executor.assertDevnet(DEVNET_CONN);

  // 2. Vault key: missing/empty → {success:false} envelope; JSON array loads.
  for (const bad of [undefined, '', '   ']) {
    assert.throws(() => executor.loadVaultKeypair(bad), (e: unknown) => {
      const body = (e as { getResponse?: () => unknown }).getResponse?.() as { success?: boolean };
      return body?.success === false;
    });
  }
  const kp = Keypair.generate();
  const loaded = executor.loadVaultKeypair(JSON.stringify(Array.from(kp.secretKey)));
  assert.equal(loaded.publicKey.toBase58(), kp.publicKey.toBase58());
  assert.throws(() => executor.loadVaultKeypair('not-a-key'), /vault/i);

  // 3. Quote: parses mocked Jupiter response; non-ok → envelope error.
  const okFetch = (async () =>
    new Response(
      JSON.stringify({ outAmount: '119344', otherAmountThreshold: '118748', priceImpactPct: '0.01' }),
      { status: 200 },
    )) as unknown as typeof fetch;
  const quote = await executor.fetchQuote(
    { inputMint: 'So111', outputMint: 'EPjFW', amount: '1000000', slippageBps: 50 },
    okFetch,
  );
  assert.equal(quote.outAmount, '119344');
  const badFetch = (async () => new Response('err', { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(
    () => executor.fetchQuote({ inputMint: 'So111', outputMint: 'EPjFW', amount: '1', slippageBps: 50 }, badFetch),
    /quote/i,
  );

  // 4. Proof: builds + confirms via mocked connection (dust transfer to self).
  let sent = 0;
  const fakeConn = {
    getAccountInfo: async () => ({ lamports: 1_000_000_000 }),
    sendTransaction: async () => {
      sent += 1;
      return 'sig'.padEnd(88, '1');
    },
    confirmTransaction: async () => ({ value: { err: null } }),
    getSignatureStatus: async () => ({ value: { confirmationStatus: 'confirmed', slot: 42 } }),
  } as never;
  const proof = await executor.executeProof(fakeConn, Keypair.generate(), 0.0001);
  assert.equal(sent, 1);
  assert.equal(proof.slot, 42);
  assert.equal(proof.signature.length, 88);
  const nullStatusConn = {
    getAccountInfo: async () => ({ lamports: 1_000_000_000 }),
    sendTransaction: async () => 's'.padEnd(88, '2'),
    confirmTransaction: async () => ({ value: { err: null } }),
    getSignatureStatus: async () => ({ value: null }),
  } as never;
  await assert.rejects(
    () => executor.executeProof(nullStatusConn, Keypair.generate(), 0.0001),
    /not found/,
  );

  // 5. Orchestration with fakes: gate-off / missing-confirm / cap → envelope;
  //    happy path → CONFIRMED; executor throw → FAILED persisted + throw.
  const orders: Record<string, Record<string, unknown>> = {};
  let seq = 0;
  // Configurable live counts for exposure-cap asserts (shared reference).
  const liveCounts = { trader: 0, mint: 0 };
  const fakePrisma = {
    vault: { findMany: async () => [{ id: 1, status: 'live', rulesJson: null }] },
    epochCheckpoint: { findMany: async () => [] },
    copyOrder: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        orders[String(seq)] = { ...data, id: seq, createdAt: new Date('2026-09-30T00:00:00.000Z') };
        return orders[String(seq)];
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        orders[String(where.id)] = { ...orders[String(where.id)], ...data };
        return orders[String(where.id)];
      },
      count: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.masterWallet) return liveCounts.trader;
        if (where.symbol) return liveCounts.mint;
        return 0;
      },
      findMany: async () => [],
    },
  } as never;
  const stubRugs = {
    qualify: async () => ({ pass: true, reasons: [], verdict: { mint: 'M', score: 1, rugged: false, riskNames: [] } }),
  } as never;
  const stubMarket = {
    bulkPrices: async () => ({}),
    tokenDetails: async () => null,
    candles: async () => [],
  } as never;
  const stubVaults = {
    status: async () => ({ lastEpoch: null }),
  } as never;
  const svc = new CopyTradeService(fakePrisma, executor, stubRugs, stubMarket, stubVaults);
  const base = { mode: 'paper' as const, confirm: true as const, symbol: 'SOL', action: 'BUY' as const };

  await assert.rejects(
    () => svc.executePaper({ ...base }, { paperEnabled: false, maxUsd: 100 }),
    /disabled/i,
  );
  await assert.rejects(
    () => svc.executePaper({ mode: 'paper' } as never, { paperEnabled: true, maxUsd: 100 }),
    /confirm/i,
  );
  await assert.rejects(
    () => svc.executePaper({ ...base, amountUsd: 101 }, { paperEnabled: true, maxUsd: 100 }),
    /cap/i,
  );

  // 6. Happy path (stubbed executor/connection) → CONFIRMED with signature.
  const stubExecutor = {
    assertDevnet: async () => undefined,
    fetchQuote: async () => ({ outAmount: '119344', otherAmountThreshold: '118748' }),
    loadVaultKeypair: () => Keypair.generate(),
    executeProof: async () => ({ signature: 'z'.padEnd(88, '9'), slot: 7 }),
  } as unknown as PaperExecutorService;
  const done = await svc.executePaper(
    { ...base, amountUsd: 50 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
  );
  assert.equal(done.status, 'CONFIRMED');
  assert.equal(done.devnetSignature, 'z'.padEnd(88, '9'));
  assert.equal(orders['1'].status, 'CONFIRMED');

  // 7. Executor failure → FAILED persisted + envelope rethrown.
  const { BadRequestException } = await import('@nestjs/common');
  const failingExecutor = {
    ...stubExecutor,
    executeProof: async () => {
      throw new BadRequestException({ success: false, message: 'boom-devnet' });
    },
  } as never;
  await assert.rejects(
    () =>
      svc.executePaper(
        { ...base, amountUsd: 10 },
        { paperEnabled: true, maxUsd: 100, executor: failingExecutor, connection: {} as never },
      ),
    /boom-devnet/,
  );
  assert.equal(orders['2'].status, 'FAILED');

  // 8b. Qualify: blocked mint → FAILED + throw; lenient proceeds with note.
  const blockRugs = {
    qualify: async () => ({ pass: false, reasons: ['flagged rugged'], verdict: { mint: 'B', score: 9, rugged: true, riskNames: ['x'] } }),
  } as never;
  await assert.rejects(
    () =>
      svc.executePaper(
        { ...base, masterWallet: 'WQ', symbol: 'MQ', tokenMint: 'B' },
        { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never, rugcheck: blockRugs },
      ),
    /Qualify blocked/,
  );
  const okQ = await svc.executePaper(
    { ...base, masterWallet: 'WQ2', symbol: 'MQ2', tokenMint: 'G' },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never, rugcheck: stubRugs, strict: false },
  );
  assert.equal(okQ.status, 'CONFIRMED');

  // 8. A1: drag>25 skipped; per-trader cap (3) and per-mint cap (2) enforced;
  //    entryMode + tp/stop params persisted with defaults.
  await assert.rejects(
    () => svc.executePaper({ ...base, delayDragPct: 30 }, { paperEnabled: true, maxUsd: 100 }),
    /ran \+/,
  );
  const counter = liveCounts;
  counter.trader = 3;
  await assert.rejects(
    () =>
      svc.executePaper(
        { ...base, masterWallet: 'W1', symbol: 'OTHER' },
        { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
      ),
    /per-trader|Exposure cap/,
  );
  counter.trader = 0;
  counter.mint = 2;
  await assert.rejects(
    () =>
      svc.executePaper(
        { ...base, masterWallet: 'W2', symbol: 'M1' },
        { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
      ),
    /per-mint|Exposure cap/,
  );
  counter.mint = 0;
  const withParams = await svc.executePaper(
    { ...base, masterWallet: 'W3', symbol: 'M2', entryMode: 'immediate', tp1Pct: 50, stopPct: 20 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
  );
  assert.equal(withParams.entryMode, 'immediate');
  assert.equal(withParams.tp1Pct, 50);
  assert.equal(withParams.stopPct, 20);

  // 9. NAV sizing: vault epoch 18 SOL @ $100 → cap min(100, 18, 10) = $10.
  const richMarket = {
    bulkPrices: async () => ({ So11111111111111111111111111111111111111112: 100 }),
    tokenDetails: async () => null,
  } as never;
  const richVaults = {
    status: async () => ({ lastEpoch: { navSol: 18 } }),
  } as never;
  const svc2 = new CopyTradeService(fakePrisma, executor, stubRugs, richMarket, richVaults);
  const sized = await svc2.executePaper(
    { ...base, masterWallet: 'W4', symbol: 'M4', amountUsd: 50 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
  );
  assert.equal(sized.status, 'CONFIRMED');
  const stored = orders[String(sized.id)] as unknown as {
    quoteJson: { sized: { masterUsd: number; copyUsd: number; capUsd: number } };
  };
  assert.equal(stored.quoteJson.sized.copyUsd, 10);
  assert.equal(stored.quoteJson.sized.capUsd, 10);

  // 10. Slippage gate: impact 500bps over default 50 → FAILED.
  const highSlip = {
    assertDevnet: async () => undefined,
    fetchQuote: async () => ({ outAmount: '1', otherAmountThreshold: '1', priceImpactPct: '5' }),
    loadVaultKeypair: () => Keypair.generate(),
    executeProof: async () => ({ signature: 'q'.padEnd(88, '8'), slot: 1 }),
  } as never;
  await assert.rejects(
    () =>
      svc2.executePaper(
        { ...base, masterWallet: 'W5', symbol: 'M5', amountUsd: 5 },
        { paperEnabled: true, maxUsd: 100, executor: highSlip, connection: {} as never },
      ),
    /Slippage/,
  );

  // 11. Liquidity gate: mcap below floor → FAILED (strict).
  const thinMarket = {
    bulkPrices: async () => ({}),
    tokenDetails: async () => ({ marketCap: 1000 }),
  } as never;
  await assert.rejects(
    () =>
      svc2.executePaper(
        { ...base, masterWallet: 'W6', symbol: 'M6', tokenMint: 'THIN', amountUsd: 5 },
        { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never, rugcheck: stubRugs, market: thinMarket },
      ),
    /mcap/,
  );

  // 12. Per-order ladder config persists + mirrors in shape (null when unset).
  const cfgOrder = await svc.executePaper(
    { ...base, masterWallet: 'W7', symbol: 'M7', amountUsd: 5, tp1ShareBps: 2500, trailPct: 10, tp2MultPct: 150 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
  );
  assert.equal(cfgOrder.status, 'CONFIRMED');
  assert.equal(cfgOrder.tp1ShareBps, 2500);
  assert.equal(cfgOrder.trailPct, 10);
  assert.equal(cfgOrder.tp2MultPct, 150);
  const plainOrder = await svc.executePaper(
    { ...base, masterWallet: 'W8', symbol: 'M8', amountUsd: 5 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never },
  );
  assert.equal(plainOrder.tp1ShareBps, undefined);
  assert.equal(plainOrder.trailPct, undefined);
  assert.equal(plainOrder.tp2MultPct, undefined);

  // 13. ATR regime auto-tune: wild candles → tuned tp/stop/trail + note.
  const wildCandles = Array.from({ length: 20 }, (_, i) => ({
    open: 100, high: 150, low: 50, close: 100, volume: 1, timestamp: i,
  }));
  const tuneMarket = {
    bulkPrices: async () => ({}),
    tokenDetails: async () => null,
    candles: async () => wildCandles,
  } as never;
  const tuned = await svc.executePaper(
    { ...base, masterWallet: 'W9', symbol: 'M9', tokenMint: 'WILD', amountUsd: 5 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never, market: tuneMarket },
  );
  assert.equal(tuned.status, 'CONFIRMED');
  assert.equal(tuned.tp1Pct, 80);
  assert.equal(tuned.stopPct, 40);
  assert.equal(tuned.trailPct, 30);
  const tunedRow = orders[String(tuned.id)] as unknown as {
    quoteJson: { sized: { tune: { mode: string; regime: string } } };
  };
  assert.equal(tunedRow.quoteJson.sized.tune.mode, 'atr-regime');
  assert.equal(tunedRow.quoteJson.sized.tune.regime, 'wild');
  // Explicit params win over tune (per-field); tune still notes the regime.
  const pinned = await svc.executePaper(
    { ...base, masterWallet: 'W10', symbol: 'M10', tokenMint: 'WILD', amountUsd: 5, tp1Pct: 50 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never, market: tuneMarket },
  );
  assert.equal(pinned.tp1Pct, 50);
  assert.equal(pinned.stopPct, 40);
  // No candles → fallback 60/30; autoTune:false → fixed defaults.
  const noCandleMarket = {
    bulkPrices: async () => ({}),
    tokenDetails: async () => null,
    candles: async () => [],
  } as never;
  const fallback = await svc.executePaper(
    { ...base, masterWallet: 'W11', symbol: 'M11', tokenMint: 'THIN2', amountUsd: 5 },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never, market: noCandleMarket },
  );
  assert.equal(fallback.tp1Pct, 60);
  assert.equal(fallback.stopPct, 30);
  const off = await svc.executePaper(
    { ...base, masterWallet: 'W12', symbol: 'M12', tokenMint: 'WILD', amountUsd: 5, autoTune: false },
    { paperEnabled: true, maxUsd: 100, executor: stubExecutor, connection: {} as never, market: tuneMarket },
  );
  assert.equal(off.tp1Pct, 60);
  assert.equal(off.stopPct, 30);

  console.log('paper-executor asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
