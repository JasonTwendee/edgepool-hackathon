/**
 * Executable evidence for G1 (market ticks server cache + single-flight).
 * Run: `npx tsx src/modules/market/assert-market.ts` (mocked fetch).
 */
import assert from 'node:assert/strict';
import { MarketService } from './market.service.js';

const body = {
  bitcoin: { usd: 1, usd_24h_change: 0.5 },
  ethereum: { usd: 2, usd_24h_change: -0.5 },
  solana: { usd: 3, usd_24h_change: 1.5 },
  'usd-coin': { usd: 4, usd_24h_change: 0 },
};

function stubGlobalFetch(impl: (url: string) => Promise<Response>): { counter: { n: number }; restore: () => void } {
  const prev = globalThis.fetch;
  const counter = { n: 0 };
  globalThis.fetch = (async (url: unknown) => {
    counter.n += 1;
    return impl(String(url));
  }) as typeof fetch;
  return { counter, restore: () => {
    globalThis.fetch = prev;
  } };
}

const ok = () => new Response(JSON.stringify(body), { status: 200 });

async function main(): Promise<void> {
  // Values parse; repeated calls share one fetch (TTL cache).
  {
    const { counter, restore } = stubGlobalFetch(async () => ok());
    try {
      const svc = new MarketService({} as never);
      const r1 = await svc.ticks();
      assert.equal(r1.stale, false);
      assert.equal(r1.ticks.find((t) => t.id === 'solana')?.priceUsd, 3);
      const r2 = await svc.ticks();
      assert.equal(r2.stale, false);
      assert.equal(counter.n, 1);
    } finally {
      restore();
    }
  }

  // Concurrent cold calls share one fetch (single-flight).
  {
    const { counter, restore } = stubGlobalFetch(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return ok();
    });
    try {
      const svc = new MarketService({} as never);
      await Promise.all([svc.ticks(), svc.ticks()]);
      assert.equal(counter.n, 1);
    } finally {
      restore();
    }
  }

  // Failure → stale + nulls, never cached (next call retries).
  {
    const { counter, restore } = stubGlobalFetch(async () => {
      if (counter.n === 1) return new Response('{}', { status: 429 });
      return ok();
    });
    try {
      const svc = new MarketService({} as never);
      const r1 = await svc.ticks();
      assert.equal(r1.stale, true);
      const r2 = await svc.ticks();
      assert.equal(r2.stale, false);
      assert.equal(counter.n, 2);
    } finally {
      restore();
    }
  }

  console.log('market asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error('ASSERT FAILED:', e);
  process.exit(1);
});
