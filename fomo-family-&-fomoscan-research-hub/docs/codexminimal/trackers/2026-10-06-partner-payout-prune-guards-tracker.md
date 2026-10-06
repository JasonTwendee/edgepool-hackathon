# Tracker — Partner Payout Verify + Prune Guards (7, 10, 11)

Topic: partner-payout-prune-guards | Intent: `docs/codexminimal/idsd/2026-10-06-partner-payout-prune-guards-intent.md` | Plan: `docs/codexminimal/plans/2026-10-06-partner-payout-prune-guards-phase-plan.md`

## Status

- [x] P1 migration + schema + regen
- [x] P2 F7 backend + asserts
- [x] P3 F7 FE + typecheck
- [x] P4 F10 prune archive + assert
- [x] P5 F11 rotation guards + assert
- [x] P6 verify + review

## Handoff log

- 2026-10-06: intent approved (challenge+verify, archive+audit). Plan written. Starting P1.
- 2026-10-06 P1 done: migration `20261006000004_payout_wallet_verify` (users.payout_wallet_verified_at + payout_wallet_challenges table) applied via `migrate deploy` on live DB; generated client regened; BE typecheck green.
- 2026-10-06 P2 done: challenge/verify/claim-gate in `partner.service.ts` + `PayoutChallengeDto` + `signature` required + `/challenge` route + openapi; `assert-partner` §3 rewritten (bad/no/expired/wrong-key/good + claim gate) with in-test ed25519 fixtures.
- 2026-10-06 P3 done: `lib/api` challenge/verify calls + `PartnerMe.payoutWalletVerified` + trader page sign-with-payout-wallet flow + claim gating; FE typecheck green.
- 2026-10-06 P4 done: `pruneOnce` archives JSONL + `sync.prune_archive` audit before delete-by-ID, fail-safe zero-delete; new `sync/assert-sync.ts` (empty/archive/fail-safe/ledger-untouched); `SyncModule` imports `AuditModule`; `backend/data/` gitignored.
- 2026-10-06 P5 done: rotation prune skips ACTIVE/open-order/active-trader wallets + `wallet.rotation_prune` audit; `assert-leaderboard` +§8/9/10; fixed pre-existing mock Decimal bug (`fomoPnlUsd` raw number → `toTrackedWallet` crash, red on main before this work).
- 2026-10-06 P6 done: BE+FE typecheck green; 17/17 assert suites green; openapi 61 paths valid; `migrate deploy` clean.

## Review verdict

APPROVE (nestjs-code-reviewer findings-only self-review):
- Controllers thin, `validateDto` explicit, envelopes preserved (400 validation / 401 signature).
- Challenge bound to (userId, wallet, owner-login-wallet, nonce, expiry); nonces single-use + unique; no signature stored; `verify_failed` audit logs identity+reason only.
- Prune deletes exactly archived IDs; money ledger never in scope; rotation never deletes live-referenced wallets.
- No protected paths touched. Migration additive-only (nullable column + new table, FK cascade).

## Divergences / notes

- Audit said "prune 35 ngày" — source says `HISTORY_DAYS` default 120d (`FULL_HISTORY_DAYS` env). Source wins; behavior keeps 120d window, now with archive+audit.
- Legacy payout wallets must re-verify (fail-closed, no grandfathering); FE surfaces verify prompt.
- `ARCHIVE_DIR` default `data/archive` is container-ephemeral — audit row is durable proof; compose must volume-mount it (runbook follow-up).

## Test gaps

- Live browser sign flow (real Phantom/OKX) not E2E'd — crypto covered by unit with real ed25519.
- No 2-conn rotation/prune race test (single-tick guards only).

## Next phase

None for 7/10/11. Remaining audit items: 8 (mainnet execution), 9 (oracle), 12+13 (limits). Awaiting direction.
