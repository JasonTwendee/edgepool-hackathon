/**
 * Executable evidence for FomoScan sponsor client (P0).
 * Run: `npx tsx src/common/fomoscan/assert-fomoscan.ts` (mocked fetch only).
 */
import assert from 'node:assert/strict';
import { FomoscanService } from './fomoscan.service.js';
import type { FomoscanFetch } from './fomoscan.service.js';

type Row = Record<string, unknown>;

function mock(routes: Record<string, unknown>, calls: string[]): FomoscanFetch {
  return (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const u = new URL(url);
    const body = init?.body ? (JSON.parse(init.body) as Row) : undefined;
    const key = `${init?.method ?? 'GET'} ${u.pathname}${u.search}`;
    // Batch route matches on body shape (handles list).
    if (u.pathname === '/v2/user/handles/pnl' && body) {
      const entries = ((body.handles as string[]) ?? []).map((h) => ({
        handle: h,
        wallet: `W_${h}`,
        evmWallet: null,
        status: 'ready',
        updatedAt: 1,
        windows: { '24h': { netUsd: 10, returnPct: 0.1, volumeUsd: 100, trades: 5, buys: 3, sells: 2, tokensTraded: 2, winningTokens: 1, rank: null, status: 'ready', updatedAt: 1 } },
      }));
      return { ok: true, status: 200, json: async () => ({ count: entries.length, entries }) };
    }
    if (!(key in routes)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[key] };
  }) as FomoscanFetch;
}

async function main(): Promise<void> {
  const svc = new FomoscanService().configure('https://x.test', 'k');
  const calls: string[] = [];
  const f = mock(
    {
      'GET /v2/user/handle/unipcs': {
        id: '1', handle: 'unipcs', name: 'Unipcs', bio: 'b', profilePicture: 'p',
        twitter: null, solanaAddress: 'W1', evmAddress: '0x1',
      },
      'GET /v2/user/handle/unipcs/pnl': {
        handle: 'unipcs', wallet: 'W1', evmWallet: '0x1', status: 'ready', updatedAt: 1,
        windows: { '24h': { netUsd: -5, returnPct: 0, volumeUsd: 1, trades: 2, buys: 1, sells: 1, tokensTraded: 1, winningTokens: 0, rank: null, status: 'ready', updatedAt: 1 } },
      },
      'GET /v2/pump/leaderboard/traders?period=weekly&limit=2': {
        entries: [{ rank: 1, wallet: 'W9', username: 'u', isVerified: true, pnlSol: 1, pnlUsd: 2, pnlPercent: 3, realizedPnlUsd: 4, unrealizedPnlUsd: 5 }],
      },
      'GET /v2/user/wallet/W1': {
        id: '1', handle: 'unipcs', name: 'Unipcs', bio: 'b', profilePicture: 'p',
        twitter: null, solanaAddress: 'W1', evmAddress: '0x1',
      },
    },
    calls,
  );

  // 1. Identity resolve (+ @ prefix tolerated) and wallet lookup.
  const idn = await svc.resolveHandle('@unipcs', f);
  assert.equal(idn.solanaAddress, 'W1');
  assert.equal(idn.evmAddress, '0x1');
  await assert.rejects(() => svc.resolveHandle('  ', f), /Handle is required/);
  const byWallet = await svc.lookupWallet('W1', f);
  assert.equal(byWallet.handle, 'unipcs');
  await assert.rejects(() => svc.lookupWallet('  ', f), /Wallet address is required/);

  // 2. Single PnL windows.
  const pnl = await svc.getPnl('unipcs', f);
  assert.equal(pnl.windows['24h'].netUsd, -5);

  // 3. Batch PnL (one call, many handles).
  const batch = await svc.batchPnl(['unipcs', 'a', 'unipcs', ' '], f);
  assert.equal(batch.count, 2); // de-duped + blank dropped
  assert.deepEqual(batch.entries.map((e) => e.handle), ['unipcs', 'a']);
  await assert.rejects(() => svc.batchPnl(Array.from({ length: 101 }, (_, i) => `h${i}`), f), /at most 100/);
  assert.deepEqual(await svc.batchPnl([], f), { count: 0, entries: [] });

  // 4. Leaderboard clamp + period + mapping.
  const lb = await svc.leaderboard(2, 'weekly', f);
  assert.equal(lb.entries[0].username, 'u');
  assert.ok(lb.entries[0].isVerified);
  const lbDefault = await svc.leaderboard(2, 'bogus' as 'weekly', f);
  assert.equal(lbDefault.entries[0].username, 'u');

  // 5. Cache: second identical call performs no fetch.
  const before = calls.length;
  await svc.getPnl('unipcs', f);
  assert.equal(calls.length, before);

  // 6. Disabled without key.
  const bare = new FomoscanService().configure('https://x.test', '');
  assert.equal(bare.enabled(), false);
  await assert.rejects(() => bare.getPnl('unipcs', f), /not configured/);

  // 7. HTTP errors surface with status + route.
  const bad: FomoscanFetch = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as FomoscanFetch;
  await assert.rejects(() => new FomoscanService().configure('https://x.test', 'k').getPnl('z', bad), /429/);

  console.log('fomoscan asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
