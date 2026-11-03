# Intent — KOL pool allowlist + 5-trader display + traceability

Date: 2026-11-03  
Status: approved by user (A / C / no refund)

## Intent

KOL (partner) pools must be **invite-only for deposits**. A user can deposit
only when they are a KOL account explicitly added to that pool. Basket pools
stay open. Existing non-KOL balances are returned to their owners.

In the KOL `/trader` portal, the pool must show exactly the live 5-trader
roster; rotated-out memberships belong in a collapsed history, never in the
current count.

## Decisions

1. **Ownership model A** — pools 14 (`KOL Star Pool`) and 43 (`KOL Devnet Pool`)
   remain owned by the system `kol` account (user id 8). Seeing both in
   `/trader` is correct; no data change hides pool 14.
2. **Max traders fixed at 5** for `kind='partner'`. The owner UI no longer
   offers 3/4. The shared roster remains 5 wallets across the public demo pools.
3. **Display active only** — API returns `data` = active roster and `history` =
   rotated-out memberships. UI shows `5 of 5 active`; history is collapsed.
4. **Deposit allowlist C** — new `vault_members` table. Only `role=KOL`
   accounts added by the owner KOL or ADMIN can deposit. The owner is
   auto-added; ADMIN bypasses. Withdrawals are never gated.
5. **Leave grandfathered non-KOL deposits as-is** (user-confirmed 2026-11-03).
   No refund is executed. Existing holders keep their shares and can still
   withdraw voluntarily; only new deposits are blocked by the allowlist.

## Non-goals

- No mainnet work, no P4/P5, no audit/multisig.
- No change to basket pool deposits (pool 15 remains open).
- No hard-delete of trader history.

## Acceptance

- `USER` deposit into pool 14 or 43 is rejected by both paper and on-chain
  paths with an invite-only message; existing USER shares can still withdraw.
- `kol` owner can deposit into pools 14/43 without an explicit allowlist row.
- ADMIN can deposit for testing; owner can add/remove another KOL.
- `/trader` shows 5 active traders and a collapsed `Past traders (N)` section.
- `maxTraders` cannot be set to 3/4 on a partner pool; assignment/rotation
  never exceeds 5 active.
- No refund rows are created; grandfathered balances stay in place and remain
  withdrawable.

## Verification

- `npx tsx src/modules/partner/assert-partner.ts`
- `npx tsx src/modules/vaults/assert-deposit-policy.ts`
- `npm --prefix backend run typecheck`
- `npm --prefix frontend run typecheck`
- Live E2E after deploy: login `user` → pool 14/43 deposit blocked; login `kol`
  → deposit allowed; add a second KOL → allowed; remove → blocked.
