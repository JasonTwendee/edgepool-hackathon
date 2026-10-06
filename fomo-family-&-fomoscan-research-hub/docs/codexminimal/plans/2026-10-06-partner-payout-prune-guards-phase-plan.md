# Phase Plan — Partner Payout Verify + Prune Guards (7, 10, 11)

Topic: partner-payout-prune-guards
Intent: `docs/codexminimal/idsd/2026-10-06-partner-payout-prune-guards-intent.md`
Tracker: `docs/codexminimal/trackers/2026-10-06-partner-payout-prune-guards-tracker.md`
Approvals: scope 7/10/11 + challenge+verify + archive+audit (2026-10-06). No protected paths.

## Phase map

- P1 — F7 migration + schema + client regen.
- P2 — F7 service/DTO/controller/openapi + asserts.
- P3 — F7 FE + FE typecheck.
- P4 — F10 prune archive + audit + assert.
- P5 — F11 rotation guards + audit + assert.
- P6 — Verify + review.

## Dependencies

P1 → P2 → P3 (F7 chain). P4, P5 independent of F7 (different modules) — run after P3 for review clarity. P6 last.

## P1 executable steps (migration)

1. `backend/prisma/schema.prisma`: `User` add `payoutWalletVerifiedAt DateTime? @map("payout_wallet_verified_at") @db.Timestamptz()`; new model `PayoutWalletChallenge`:
   `id Int @id @default(autoincrement())`, `userId Int @map("user_id")`, `user User @relation(fields:[userId], references:[id], onDelete:Cascade)`, `wallet String @db.VarChar(64)`, `nonce String @unique @db.VarChar(64)`, `expiresAt DateTime @map("expires_at") @db.Timestamptz()`, `consumedAt DateTime? @map("consumed_at") @db.Timestamptz()`, `createdAt DateTime @map("created_at") @default(now()) @db.Timestamptz()`, `@@map("payout_wallet_challenges")`, `@@index([userId])`. Add `User.payoutChallenges PayoutWalletChallenge[]`.
2. Migration dir `backend/prisma/migrations/20261006000004_payout_wallet_verify/migration.sql` (follow `20261006000003` style: ALTER TABLE users ADD COLUMN payout_wallet_verified_at TIMESTAMPTZ; CREATE TABLE payout_wallet_challenges + index + FK users cascade).
3. Regen generated client (`src/generated/prisma` is committed — refresh per repo flow; BE typecheck must pass).
4. Verify: `npm --prefix backend run typecheck`; `git status` shows schema + migration + regenerated models (User/PayoutWalletChallenge).

## P2 executable steps (F7 backend)

1. `partner.service.ts`: import `randomBytes`, `verifyEd25519Signature`, `AuditService`; constructor add `@Inject(AuditService) audit` (PartnerModule already imports AuditModule — confirm export pattern matches vaults module).
   - `payoutChallengeMessage(payout, ownerLoginWallet, nonce, expiresAt)` pure exported helper (asserts + FE display).
   - `issuePayoutChallenge(user, wallet)`: assertWallet, 5min TTL, `payoutWalletChallenge.create({userId, wallet: clean, nonce, expiresAt})`, return `{wallet, nonce, message, expiresAt}`.
   - `setPayoutWallet(user, wallet, signature)`: assertWallet; require non-empty signature else 401 `Signature required…`; find live challenge `(userId, wallet, consumedAt null, expiresAt > now)` latest; `verifyEd25519Signature(Buffer.from(message,utf8), signature, clean)` else 401 + `auditFail`-style `partner.verify_failed` row (never throw from audit); consume nonce; `user.update({payoutWallet: clean, payoutWalletVerifiedAt: new Date()})`; audit `partner.payout_wallet_verified`.
   - `claim()`: refuse when `!(payoutWallet) || !payoutWalletVerifiedAt` → 400 `Verify your payout wallet first.` (keep `Connect a payout wallet first.` when wallet null? merge: null → connect message; unverified → verify message).
   - `me()`: add `payoutWalletVerified: !!payoutWalletVerifiedAt`.
2. `partner/dto/partner.dto.ts`: `PayoutWalletDto` add required `signature: string`; new `PayoutChallengeDto {wallet}`.
3. `partner.controller.ts`: `POST /api/partner/payout-wallet/challenge` (KOL/ADMIN, validateDto PayoutChallengeDto) + `payoutWallet` passes `dto.signature`. Claim route unchanged.
4. OpenAPI: new path `/api/partner/payout-wallet/challenge` + updated `PayoutWalletDto` (wallet+signature) + `me()` verified flag + claim 400 case.
5. `partner/assert-partner.ts`: mock `payoutWalletChallenge` store + `user.payoutWalletVerifiedAt` field; update §3 (claim rejects unverified; challenge→sign with fixture key→set→claim ok; bad sig rejects; wallet change clears verifiedAt). Fixture signing: generate ed25519 keypair in-test (node:crypto `generateKeyPairSync('ed25519')` + `sign(null, msg, priv)`), derive base58 pubkey via existing codec — no network.
6. Verify: BE typecheck + `npx tsx src/modules/partner/assert-partner.ts` GREEN.

## P3 executable steps (F7 FE)

1. `frontend/lib/api.ts`: `partnerPayoutChallenge(token, wallet)` → challenge; `partnerSetPayoutWallet(token, wallet, signature)` (signature required).
2. `frontend/app/trader/page.tsx` Connect panel: step 1 enter wallet → challenge (show message + wallet match check: signed wallet must equal entered wallet, else error); step 2 `signWithBrowserWallet(challenge.message)` (existing `lib/solana.ts:125`) → submit `{wallet, signature}`; verified state shows `payout → … ✓ verified`, else prompt verify. Claim button disabled unless `me.payoutWalletVerified`.
3. `frontend/types/*` PartnerMe: add `payoutWalletVerified: boolean`.
4. Verify: `npm --prefix frontend run typecheck`.

## P4 executable steps (F10 prune archive)

1. `sync/sync.module.ts`: add `AuditModule` to imports (AuditService not currently available in SyncModule).
2. `sync/sync.service.ts`: constructor add `@Inject(AuditService) audit` (import; keep tsx-safe @Inject style).
   - Pure helper `pruneCutoff(days)`, `archiveFileName(kind, now)`.
   - `pruneOnce`: `findMany` old rows (select only columns needed for evidence: signature/walletAddress/slot/blockTime/action/symbol/tokenMint/amounts for tx; id/eventType/walletAddress/txSignature/title/broadcastedAt for events); `mkdir ARCHIVE_DIR recursive`; append JSONL `prune-<yyyymmdd>-transactions.jsonl` / `-events.jsonl` (one JSON object per line incl. `archivedAt`); sha256 each file; `audit.record({actor:'system:sync', action:'sync.prune_archive', target: filenames, reason: counts+cutoff+sha})`; then existing `deleteMany`. Any archive/audit throw → log + return 0 with ZERO deletes (fail-safe). Keep once/day throttle + sync log line (extend with `archived=`).
   - `ARCHIVE_DIR = process.env.PRUNE_ARCHIVE_DIR ?? 'data/archive'` (repo-relative `backend/data/archive`, gitignored if needed — check `.gitignore`; runbook note: volume-mount in compose for durability).
3. New or extended assert (`sync/assert-sync.ts` or extend existing if present — check; else create): tmpdir archive, old rows archived+deleted + audit row; archive-write failure (read-only dir) → 0 deletes; money tables (deposit/withdrawal/epoch/payout/audit) untouched (mock exposes them, assert counts unchanged).
4. Verify: BE typecheck + new/updated assert GREEN.

## P5 executable steps (F11 rotation guards)

1. `leaderboard/leaderboard.service.ts`: constructor add `@Inject(AuditService) audit` (LeaderboardModule already imports AuditModule).
   - Prune block: load `openWallets = copyOrder.findMany({where:{closedAt:null}, select:{masterWallet:true}})` → Set; `activeTraders = vaultTrader.findMany({where:{isActive:true}, select:{wallet:true}})` → Set; victims = INACTIVE oldest-first `take total-cap` filtered by NOT in either set. If filter empties victims → prune 0 (cap stays exceeded; note in summary? add `note` only when victims skipped — keep shape, log warn).
   - After delete: `audit.record({actor:'system:rotation', action:'wallet.rotation_prune', target: victims.join(','), reason: cap/total})` best-effort (warn on fail, don't fail tick).
2. `leaderboard/assert-leaderboard.ts`: mock `copyOrder`, `vaultTrader`, `auditLog`; new cases: (a) INACTIVE with open order survives; (b) INACTIVE in active trader set survives; (c) prune writes audit row with victim list; existing §4 still passes.
3. Verify: BE typecheck + assert-leaderboard GREEN.

## P6 verification

- `npm run typecheck` (BE+FE) green.
- All `assert-*.ts` suites green (partner ×2, leaderboard, sync new, plus full sweep as in 1–6).
- `openapi.yaml` valid YAML + new paths present.
- Migration applies cleanly on fresh DB (`prisma migrate deploy` against compose postgres if available; else `prisma validate`/dry-run + BE boot smoke).
- Review: `nestjs-code-reviewer` findings-only → APPROVE before tracker done.

## Stop conditions

- Migration fails twice → stop, record blocker (do not hand-edit applied migrations).
- Any assert/typecheck red twice → stop.
- Archive FS seam untestable → fall back to env-gated disable + re-approve (per intent stop condition).
- Scope drift (on-chain transfer, multisig) → stop, new intent.
