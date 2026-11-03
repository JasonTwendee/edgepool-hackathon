/**
 * Executable evidence for the KOL-pool deposit allowlist.
 * Run: `npx tsx src/modules/vaults/assert-deposit-policy.ts` (no DB/network).
 */
import assert from 'node:assert/strict';
import { depositPolicy, type PolicyPrisma } from '../../common/pools/deposit-policy.js';

const members = new Set<string>(['43:9']);
const prisma = {
  vaultMember: {
    findUnique: async ({ where }: { where: { vaultId_userId: { vaultId: number; userId: number } } }) => {
      const key = `${where.vaultId_userId.vaultId}:${where.vaultId_userId.userId}`;
      return members.has(key) ? { id: 1 } : null;
    },
  },
} as unknown as PolicyPrisma;

async function main(): Promise<void> {
  // Basket pools are open to every signed-in user.
  assert.deepEqual(await depositPolicy(prisma, { id: 15, kind: 'basket' }, { id: 11, role: 'USER' }), {
    policy: 'open',
    allowed: true,
    reason: null,
  });

  // Partner pools require a signed-in user.
  const anon = await depositPolicy(prisma, { id: 43, kind: 'partner', ownerUserId: 8 });
  assert.equal(anon.policy, 'kol_allowlist');
  assert.equal(anon.allowed, false);

  // Regular USER is refused even if they have pool shares (withdraw remains open).
  const user = await depositPolicy(prisma, { id: 43, kind: 'partner', ownerUserId: 8 }, { id: 11, role: 'USER' });
  assert.equal(user.allowed, false);
  assert.match(user.reason ?? '', /invite-only/i);

  // KOL not on the allowlist is refused.
  const stranger = await depositPolicy(prisma, { id: 43, kind: 'partner', ownerUserId: 8 }, { id: 10, role: 'KOL' });
  assert.equal(stranger.allowed, false);
  assert.match(stranger.reason ?? '', /ask the pool owner/i);

  // Owner KOL is always allowed without an explicit row.
  const owner = await depositPolicy(prisma, { id: 43, kind: 'partner', ownerUserId: 8 }, { id: 8, role: 'KOL' });
  assert.equal(owner.allowed, true);

  // Invited KOL is allowed.
  const invited = await depositPolicy(prisma, { id: 43, kind: 'partner', ownerUserId: 8 }, { id: 9, role: 'KOL' });
  assert.equal(invited.allowed, true);

  // ADMIN bypasses the allowlist for operations/testing.
  const admin = await depositPolicy(prisma, { id: 43, kind: 'partner', ownerUserId: 8 }, { id: 1, role: 'ADMIN' });
  assert.equal(admin.allowed, true);

  console.log('deposit-policy asserts: ALL GREEN');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
