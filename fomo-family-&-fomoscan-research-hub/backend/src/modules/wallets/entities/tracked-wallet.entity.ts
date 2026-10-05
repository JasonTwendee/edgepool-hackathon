import type { TrackedWallet as PrismaTrackedWallet } from '../../../generated/prisma/client.js';

/** API shape — mirrors openapi.yaml#TrackedWallet (stable for FE). */
export interface TrackedWallet {
  address: string;
  label: string;
  handle: string;
  avatar?: string;
  bio?: string | null;
  evmAddress?: string | null;
  totalPnlUsd?: number;
  winRate?: number;
  isCopyEnabled: boolean;
  allocationWeight: number;
  addedAt: string;
}

/**
 * DB (reference schema) → API mapping. The diagram has no avatar column and
 * renames fields (is_active, allocation_weight NUMERIC, cumulative_pnl_usd,
 * win_rate, created_at) — all reconciled here so openapi.yaml never changes.
 * Decimal → Number, DateTime → YYYY-MM-DD, avatar stays undefined (FE does not
 * render live-wallet avatars; they only exist in static demo data).
 */
export function toTrackedWallet(e: PrismaTrackedWallet): TrackedWallet {
  return {
    address: e.address,
    label: e.label,
    handle: e.handle,
    avatar: e.avatarUrl ?? undefined,
    bio: e.bio ?? null,
    evmAddress: e.evmAddress ?? null,
    totalPnlUsd: e.cumulativePnlUsd?.toNumber() ?? undefined,
    winRate: e.winRate?.toNumber() ?? undefined,
    isCopyEnabled: e.isActive,
    allocationWeight: e.allocationWeight.toNumber(),
    addedAt: e.createdAt.toISOString().split('T')[0],
  };
}
