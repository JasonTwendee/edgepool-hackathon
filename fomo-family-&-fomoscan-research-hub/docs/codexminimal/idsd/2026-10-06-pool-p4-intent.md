# Intent — Trader portal (P4)

- Date: 2026-10-06
- Stage: intent-bounded → execution (user: oke)
- Parent: design handoff Trader portal + pool-math fee lines.

## 1. Bounded spec

1. Schema: Vault += `ownerUserId?`, `rulesJson?`; User += `payoutWallet?`;
   new `PartnerApplication` (fomo/x/wallet/contact/status) +
   `TraderRequest` (poolId/fomo/x/status); PartnerPayout.status += PAID.
2. Endpoints (`/api/partner`, KOL-or-ADMIN unless noted):
   - `POST /apply` (public): intake → pending.
   - `GET /me`: session trader (pools owned, payoutWallet, fees {pending, claimable, paid}, basket status).
   - `POST /payout-wallet`: set+validate base58.
   - `POST /claim`: ACCRUED→PAID (record-only; no on-chain transfer in sandbox).
   - `PATCH /pools/:id/settings`: owner-only (name/listing/status/maxSlots≥depositors/maxTraders/rulesJson).
   - `GET /pools/:id/traders`: status/signals7d/profit/fee per trader; pause/resume/remove (reuse assign/remove).
   - `POST /pools/:id/request-trader`, `GET /signals`, `GET /payouts`.
   - ADMIN: `GET /applications`, `POST /applications/:id/review`.
3. Fees: pending = unrealized partner share of open positions; claimable = ACCRUED
   sum; paid = PAID sum. Basket fee 10% note vs own-pool 15% (kind-based).
4. FE `/trader`: sign-in/apply split → dashboard (fees, pool, traders, rules, signals,
   payouts, share card link). Partner edits reflect on public pool page (same API).
5. Asserts + openapi + live verify (KOL flow end-to-end).

## 2. Non-goals

Advanced (P5), on-chain payout transfer, email delivery, OAuth.
