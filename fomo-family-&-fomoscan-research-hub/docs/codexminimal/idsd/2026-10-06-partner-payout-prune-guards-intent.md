# IDSD Intent — Partner Payout Verify + Prune Guards (7, 10, 11)

Date: 2026-10-06
Topic: partner-payout-prune-guards
Stage: intent-approved (scope 7/10/11 + challenge+verify + archive+audit, user-approved 2026-10-06)
Tracker: to be created by repo-phase-orchestrator

## 1. Intent contract

**Intent:** Close 3 HIGH money-safety gaps: unverified payout wallets (funds could flow to an attacker's wallet), evidence-destroying prunes (chain-data prune + rotation cascade prune).

**Scope (in):**
- 7: payout-wallet ownership proof via signature challenge before save; claim refuses unverified wallets. Claim stays record-only (on-chain transfer is a later phase).
- 10: `SyncService.pruneOnce` archives pruned rows to JSONL + audit row before delete; money ledger explicitly never pruned.
- 11: `LeaderboardService.tick` cap-prune guards (never ACTIVE, never wallets with open orders / active trader membership) + per-prune audit.

**Non-goals (out):**
- On-chain payout transfer (later phase; claim remains ACCRUED→PAID bookkeeping).
- Oracle staleness (9), rate-limit (12), deposit caps (13) — separate phases.
- Multisig / admin approval of payout changes — follow-up.

**Constraints:**
- BE: NestJS, tsx-safe `@Inject()`, explicit `validateDto()`, envelope `{success:false,message}`.
- `docs/api/openapi.yaml` is contract source of truth — new endpoints + schema changes documented there.
- FE `lib/api.ts` + trader page match new contract (browser-wallet `signMessage` exists in `lib/solana.ts`).
- One Prisma migration (users.payout_wallet_verified_at + payout_wallet_challenges table); regen generated client.
- No protected paths touched (`copy-trade/**`, `.env`, `config/*` — none needed).
- Asserts stay green: `partner/assert-partner.ts`, `leaderboard/assert-leaderboard.ts`, plus full suite.

**Discrepancy note (source wins):** audit claimed "prune 35 ngày" — source `sync.service.ts:10-14` shows `HISTORY_DAYS` default **120d** (env `FULL_HISTORY_DAYS`). 120d is the working value; docs updated to match.

## 2. Architecture decisions (ADR-short)

- **D1 challenge-table (fix 7):** New `payout_wallet_challenges(user_id FK cascade, wallet, nonce unique, expires_at, consumed_at)` instead of reusing `auth_nonces`. *Why:* `auth_nonces` has no user/purpose binding — attacker could race a victim's wallet challenge; new table binds `(userId, wallet)` so only the requester's signature over the owner-bound message validates.
- **D2 message binding (fix 7):** Challenge message = `Link payout wallet to Edgepool partner account\nwallet: <payout>\nowner: <loginWallet>\nnonce: <nonce>\nexpires: <iso>`, verified with `verifyEd25519Signature(msg, signature, payoutWallet)`. *Why:* binds payout key + login identity + freshness; replay across users fails (owner differs), replay across time fails (nonce consumed + 5min TTL).
- **D3 fail-closed (fix 7):** `users.payout_wallet_verified_at` NULL by default; setting a *new* wallet clears it; `claim()` refuses NULL with `Verify your payout wallet first.` Existing pre-change rows are unverified until re-verified (no grandfathering — money destination must never trust legacy input).
- **D4 archive-before-delete (fix 10):** `pruneOnce` writes pruned `transactions` + `realtime_events` to JSONL (`ARCHIVE_DIR`, default `data/archive/`) and an `audit_logs` row (action `sync.prune_archive`, counts + cutoff + file + sha256) BEFORE `deleteMany`. *Why archive+audit (not disable):* keeps DB bounded for the 120d window while preserving evidence; audit row is the durable proof even if the archive volume is ephemeral (runbook notes the volume mount).
- **D5 prune scope (fix 10):** prune touches ONLY `transactions` + `realtime_events` (raw chain data, re-fetchable). Money ledger (`deposits/withdrawals/epochs/payouts/audit/sessions/orders/vaults`) is never in prune scope — enforced by code (no new delete call sites) + assert.
- **D6 rotation guards (fix 11):** cap-prune victims = INACTIVE only (existing) AND NOT referenced by open `copyOrders` (`closedAt null`, `masterWallet`) AND NOT in any vault's ACTIVE `vaultTrader` set. Prune runs only for `total - cap` excess, oldest-first, and writes one audit row per tick (`wallet.rotation_prune`, victim addresses). *Why:* schema cascades `tracked_wallet → transactions/realtimeEvents` (FK Cascade) and orders keep plain-string `masterWallet` (join context lost silently) — guards prevent both evidence loss modes.

## 3. Bounded specification

### F7 payout verify (partner + auth primitive + migration + FE)
- Migration `20261006000004_payout_wallet_verify`: `users.payout_wallet_verified_at TIMESTAMPTZ NULL`; table `payout_wallet_challenges` (id serial, user_id int FK users cascade, wallet varchar64, nonce varchar64 unique, expires_at, consumed_at null, created_at default now; index user_id).
- Schema: `User.payoutWalletVerifiedAt DateTime? @map("payout_wallet_verified_at")`; model `PayoutWalletChallenge` + relation.
- `PartnerService`: `issuePayoutChallenge(user, wallet)` (validate base58, 5min TTL, store); `setPayoutWallet(user, wallet, signature)` (find live challenge for user+wallet, `verifyEd25519Signature`, consume, save wallet + verifiedAt, audit `partner.payout_wallet_verified`); `claim()` refuses unverified; `me()` adds `payoutWalletVerified: boolean`.
- `PayoutWalletDto` → `{wallet, signature?}`; new `PayoutChallengeDto {wallet}`; controller `POST /api/partner/payout-wallet/challenge` (KOL/ADMIN) + `POST /api/partner/payout-wallet` now requires signature. `POST /api/partner/claim` unchanged shape, new 400 when unverified.
- FE `lib/api.ts`: `partnerPayoutChallenge(token, wallet)`, `partnerSetPayoutWallet(token, wallet, signature)`; trader page Connect flow → challenge → `signMessage` via `lib/solana.ts` provider → submit; claim button disabled unless `payoutWalletVerified`.
- OpenAPI: 2 paths + `PayoutWalletDto`/`PayoutChallenge` schemas + `me()` verified flag.

### F10 prune archive (sync)
- `SyncService.pruneOnce`: before delete, `findMany` rows older than cutoff (bounded select of needed columns), append JSONL `prune-<yyyymmdd>-<kind>.jsonl` under `ARCHIVE_DIR`, sha256 file, `audit.record({actor:'system:sync', action:'sync.prune_archive', ...})`, then existing `deleteMany`. Archive failure → skip delete (fail-safe: keep rows, log error). Once/day throttle kept.
- Unit seam: archive writer injectable/pure (`buildArchiveRows` + `writeArchiveFile`) for asserts without FS (tmpdir in tests).

### F11 rotation guards (leaderboard)
- `LeaderboardService.tick` prune block: victims filtered by (a) `isActive false`, (b) address NOT IN open-order masterWallets, (c) address NOT IN active vaultTrader wallets; `take total-cap`; delete; `audit.record({actor:'system:rotation', action:'wallet.rotation_prune', target: addresses, reason: cap/total})`. Needs `AuditService` + `CopyOrder`/`VaultTrader` reads (check module providers; add if missing).
- `RotationSummary` unchanged shape (pruned count already there).

## 4. Task breakdown (for repo-phase-orchestrator)

- P1: F7 migration + schema + regen client (`prisma migrate dev` naming + `generated/prisma` refresh per repo flow).
- P2: F7 service + DTOs + controller + openapi + `assert-partner` new sections (challenge/verify/claim-gate).
- P3: F7 FE (`lib/api` + trader page sign-and-submit + verified gating) + FE typecheck.
- P4: F10 prune archive + audit + assert (tmpdir archive, fail-safe no-delete-on-error, ledger-untouched).
- P5: F11 rotation guards + audit + `assert-leaderboard` new cases (open-order wallet spared, active-trader wallet spared, audit row).
- P6: Full verify: BE+FE typecheck, all asserts, openapi YAML valid, `nestjs-code-reviewer` APPROVE.

## 5. Test contract (executable evidence)

- Existing suites stay GREEN (esp. `partner/assert-partner.ts` §3 claim flow updated to verify-first, `leaderboard/assert-leaderboard.ts` §4 cap-prune).
- New asserts:
  - challenge → verify with fixture keypair signs message → wallet saved + verifiedAt set; wrong-key signature → 401 envelope; expired/consumed nonce → rejected; changed wallet clears verifiedAt; claim with unverified → 400.
  - prune: rows older than cutoff archived to JSONL (parseable, count matches) + audit row; archive-write failure → zero deletes; deposits/withdrawals/epochs/payouts/audit untouched.
  - rotation: INACTIVE wallet with open order survives cap pressure; INACTIVE wallet in active trader set survives; ACTIVE never victim; prune writes audit row with victim list.
- Typecheck BE+FE green; openapi valid.

## 6. Agent cards (minimal)

- `nestjs-tdd-builder` (F7 challenge/verify flow — new behavior, tests-first).
- `nestjs-bug-fixer` (F10/F11 guard changes + regression asserts).
- `nestjs-code-reviewer` (pre-merge: auth/crypto, delete safety, audit coverage).
- `project-indexer` (after landing).

## 7. Acceptance evidence

- [ ] Attacker wallet without private key cannot become anyone's payout wallet (bad-sig → 401).
- [ ] Claim with unverified wallet → 400 `Verify your payout wallet first.`; verified → ACCRUED→PAID as before.
- [ ] Prune tick writes JSONL + `sync.prune_archive` audit before any delete; kill archive FS → 0 deletes.
- [ ] Cap-pressure rotation never deletes ACTIVE / open-order / active-trader wallets; each prune tick with victims writes `wallet.rotation_prune`.
- [ ] BE+FE typecheck green; all asserts green; openapi valid.

## 8. Protected-file / risk concerns

- No protected paths in scope. Risks: (a) fail-closed re-verify may annoy existing partners — accepted, money destination must not trust legacy input; FE must surface the verify prompt clearly. (b) Archive dir ephemeral in container — audit row is durable proof; runbook must volume-mount `ARCHIVE_DIR`. (c) New `AuditService` dep in leaderboard module — check providers to avoid DI break.

## 9. Next skill

`repo-phase-orchestrator` — phase plan + tracker at `docs/codexminimal/trackers/2026-10-06-partner-payout-prune-guards-tracker.md`, then native execution P1→P6.

## 10. Follow-up chain

`repo-phase-orchestrator` → native execution (`nestjs-tdd-builder` for F7, `nestjs-bug-fixer` for F10/F11, `nestjs-code-reviewer` pre-merge) → `project-indexer`.

## 11. Stop condition

Plan + tracker exist and P1–P5 code + P6 verification done with acceptance evidence above. Stop if migration can't apply cleanly twice, any assert/typecheck red twice, or archive FS seam proves untestable (then fall back to disable-prune-behind-env and re-approve).
