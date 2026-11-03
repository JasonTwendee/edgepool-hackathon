/**
 * KOL-pool deposit policy (2026-11-03 user-confirmed).
 *
 * Partner pools are invite-only: only KOL accounts on the pool's allowlist
 * (`vault_members`) may deposit. The owner KOL is always allowed; ADMIN is
 * allowed for operations/testing. Basket pools stay open to every signed-in
 * user. Withdrawals are never gated by this policy — exits must always work
 * for holders who were grandfathered before the allowlist existed.
 */
export type DepositPolicy = 'open' | 'kol_allowlist';

export interface DepositPolicyVault {
  id: number;
  kind?: string | null;
  ownerUserId?: number | null;
}

export interface DepositPolicyUser {
  id: number;
  role?: string | null;
}

export interface DepositPolicyResult {
  policy: DepositPolicy;
  allowed: boolean;
  reason: string | null;
}

interface MemberLookup {
  findUnique(args: {
    where: { vaultId_userId: { vaultId: number; userId: number } };
  }): Promise<unknown>;
}

export interface PolicyPrisma {
  vaultMember: MemberLookup;
}

/** Pure-ish policy check; only hits the DB for non-owner KOLs. */
export async function depositPolicy(
  prisma: PolicyPrisma,
  vault: DepositPolicyVault,
  user?: DepositPolicyUser,
): Promise<DepositPolicyResult> {
  const kind = (vault.kind ?? 'basket').toLowerCase();
  if (kind !== 'partner') return { policy: 'open', allowed: true, reason: null };
  if (!user) {
    return {
      policy: 'kol_allowlist',
      allowed: false,
      reason: 'Sign in with an invited KOL account to deposit into this pool.',
    };
  }
  if (user.role === 'ADMIN') return { policy: 'kol_allowlist', allowed: true, reason: null };
  if (user.role !== 'KOL') {
    return {
      policy: 'kol_allowlist',
      allowed: false,
      reason: 'This KOL pool is invite-only. Only KOL accounts added to the pool can deposit.',
    };
  }
  if (vault.ownerUserId && vault.ownerUserId === user.id) {
    return { policy: 'kol_allowlist', allowed: true, reason: null };
  }
  const member = await prisma.vaultMember.findUnique({
    where: { vaultId_userId: { vaultId: vault.id, userId: user.id } },
  });
  if (!member) {
    return {
      policy: 'kol_allowlist',
      allowed: false,
      reason: 'This KOL pool is invite-only. Ask the pool owner to add your KOL account.',
    };
  }
  return { policy: 'kol_allowlist', allowed: true, reason: null };
}
