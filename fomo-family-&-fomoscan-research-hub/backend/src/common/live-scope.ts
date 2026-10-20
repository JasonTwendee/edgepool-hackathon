import type { PrismaService } from '../database/prisma.service.js';

/**
 * Live-pipeline scope. The product only needs real-time work for wallets that
 * are actively traded by public/live pools; the leaderboard may still keep a
 * wider display universe.
 *
 * - `pool`: follow exactly the active `vault_traders` of public, live vaults.
 * - `all`: legacy behavior (every DB-active tracked wallet).
 *
 * Empty pool roster falls back to `all` so a fresh/dev DB still streams.
 */
export type LiveScopeMode = 'pool' | 'all';

export interface LiveScope {
  mode: LiveScopeMode;
  addresses: Set<string>;
}

export function selectLiveScope(rows: { wallet: string }[], mode?: string): LiveScope {
  if ((mode ?? 'pool') !== 'pool') return { mode: 'all', addresses: new Set() };
  const addresses = new Set(rows.map((r) => r.wallet).filter((w): w is string => Boolean(w)));
  if (addresses.size === 0) return { mode: 'all', addresses: new Set() };
  return { mode: 'pool', addresses };
}

/** Query the active traders of public, live pools (distinct wallets). */
export async function resolveLiveScope(prisma: PrismaService): Promise<LiveScope> {
  if ((process.env.LIVE_SCOPE_MODE ?? 'pool') !== 'pool') {
    return { mode: 'all', addresses: new Set() };
  }
  const rows = await prisma.vaultTrader.findMany({
    where: {
      isActive: true,
      vault: { listing: 'public', status: 'live' },
    },
    select: { wallet: true },
    distinct: ['wallet'],
  });
  return selectLiveScope(rows, 'pool');
}
