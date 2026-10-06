# Phase Plan — Vault Money Hardening 1–6

Topic: vault-money-hardening-1-6
Intent: `docs/codexminimal/idsd/2026-10-06-vault-money-hardening-1-6-intent.md`
Tracker: `docs/codexminimal/trackers/2026-10-06-vault-money-hardening-1-6-tracker.md`
Approval: full 1–6 approved 2026-10-06 (incl. protected `copy-trade/auto-fire.service.ts`)

## Phase map

- P1 — Settle guard (F1). Files: `backend/src/modules/vaults/vaults.controller.ts`, `dto/vault.dto.ts`, `docs/api/openapi.yaml`.
- P2 — Settle atomic + race lock (F2+F3). Files: `backend/src/modules/vaults/vault.service.ts` (`settleEpoch` + `bookFeeSplit(tx)`).
- P3 — Identity enforcement (F4). Files: DTO, controller, service, `frontend/lib/api.ts`, `frontend/components/MyVault.tsx`, `frontend/app/portfolio/page.tsx`, `frontend/app/pools/[id]/page.tsx`, openapi.
- P4 — Fee split by kind (F5). Files: `vault.service.ts:bookFeeSplit`, `assert-partner.ts` / new assert section.
- P5 — Kill-switch enforce (F6). Files: `backend/src/modules/copy-trade/auto-fire.service.ts` (approved), `assert-autofire.ts`.
- P6 — Verify. Commands: BE typecheck, asserts, FE typecheck, openapi consistency.

## Dependencies

P1 → P2 → P3 → P4 → P5 → P6. P4 independent of P3 except shared service file (merge carefully). P5 touches different module, can parallel P3/P4 but keep sequential for review clarity.

## P1 executable steps

1. `vault.dto.ts`: `VaultSettleDto` add `reason: string (IsString, MinLength 3)` required? Existing DTO has no reason; other ADMIN DTOs require reason for audit. Decision: add optional `reason?` to avoid breaking asserts, interceptor reads `body.reason` if present.
2. `vaults.controller.ts:settle`: add `@UseGuards(AuthGuard, RolesGuard) @Roles('ADMIN') @UseInterceptors(AuditInterceptor) @Audit('vault.settle')`. Keep body `{vaultId?, navSol?}`.
3. OpenAPI `/api/vaults/settle`: add `401/403`, note `ADMIN only, audited; omitted navSol = engine MTM`.
4. Verify: `npm --prefix backend run typecheck`; grep controller for guard metadata.

## P2 executable steps

1. `vault.service.ts:settleEpoch`: wrap in `this.prisma.$transaction(async (tx) => {...})`.
   - First line in tx: `await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('vault-settle-' || vaultId))`` — serialize per vault. Fallback: if `$queryRaw` unavailable in mock, guard with `typeof tx.$queryRaw === 'function'`.
   - Replace all `this.prisma.` inside settle with `tx.` (vault, deposit, withdrawal, epochCheckpoint, partnerPayout, vaultTrader).
   - `bookFeeSplit(vaultId, epochId, feeSol, tx)` — accept tx client.
   - Keep pure helpers (`windowState`, `r9/f9`) untouched.
2. HWM double-fee safety already holds; add comment.
3. Verify: existing `assert-vault.ts` must run with mock that supports `$transaction` (callback with `this.prisma` as tx) + `$queryRaw` noop. Update `assert-vault.ts` mock if needed (add `$transaction` + `$queryRaw`).

## P3 executable steps

1. DTO: `VaultDepositDto.depositor?: optional`, `VaultWithdrawDto.depositor?: optional` (keep `@IsOptional() @IsString()`), add comment `display-only, ignored when authed`.
2. Controller `deposit`/`withdraw`: `@UseGuards(AuthGuard)` (require session), signature `(body, req)` → `this.vaults.deposit(vaultId, req.user, amountSol)` / `requestWithdraw(vaultId, req.user, shares)`. Remove `OptionalAuthGuard`.
3. Service: change signatures to accept `user: {id:number; wallet:string}`:
   - `deposit(vaultId, user, amountSol, displayName?)`: `depositor = user.wallet`, `userId = user.id`. Slot check via `OR(userId, depositor=wallet)`.
   - `requestWithdraw` same. Balance check via new `depositorSharesByUser(vaultId, user)` (OR query). Keep old `depositorShares(vaultId, depositor)` for asserts/compat.
   - `mine` already user-scoped — no change.
4. FE `lib/api.ts`: `queueVaultDeposit({vaultId,amountSol}, token)` and `requestVaultWithdraw({vaultId,shares}, token)` — make `depositor?` optional, require token (still fallback to anon fetch for compat but BE will 401).
5. FE call-sites: `MyVault.tsx` (remove name input, use session wallet), `portfolio/page.tsx` (`depositor:'me'` → omit), `pools/[id]/page.tsx` (already sends wallet — keep, now ignored server-side, harmless).
6. OpenAPI: `depositor` optional in both DTOs, add `401` to deposit/withdraw.
7. Asserts: update `assert-vault.ts` deposit/withdraw calls to pass user objects; keep legacy string path tested as display-only.

## P4 executable steps

1. Add `BASKET_FEE_SHARE = 0.5` next to `PARTNER_FEE_SHARE = 0.75`.
2. `bookFeeSplit`: `const vault = await tx.vault.findUnique(...); const kind = (vault.kind ?? 'basket'); const share = kind === 'partner' ? 0.75 : 0.5; assert kind in set else fail`. Replace `PARTNER_FEE_SHARE` usage with `share`.
3. Keep conservation (`f9` floor + dust to edgepool).
4. Verify with split math: fee 1.0 basket → 0.5/0.5; partner → 0.75/0.25.

## P5 executable steps (protected — approved)

1. `auto-fire.service.ts`: inject nothing new (use existing prisma + audit).
   - Add `haltedVaults: number[]` to `AutoFireSummary`.
   - Helper `vaultLoss(vaultId): {dayPct, weekPct}` from `epochCheckpoint` (same navAt logic as VaultService.advancedView, duplicated small to avoid cross-module import).
   - Helper `killLimits(vault): {daily, weekly}` from `rulesJson.dailyKillSwitchPct/weeklyLossLimitPct ?? 5/15`.
   - In `tick()`: after loading bots/traders, group `botVault`s; for each vault: if `status !== 'live'` → mark skipped; else compute loss; if `dayPct <= -daily || weekPct <= -weekly` → `prisma.vault.update(status:'paused')`, `audit.record({actor:'system:kill-switch', action:'copy.kill_switch_halt', target:'vault:<id>', reason:...})`, add to `haltedVaults`, skip its signals.
   - Paused vaults never fire. Summary `blocked` counts skipped-by-halt? Use `haltedVaults` + note.
2. `assert-autofire.ts`: add halt case with mocked epochs (day −6% → 0 fired, halted contains vault).
3. No sizing/venue/confirm path touched — reviewer must confirm diff limited to halt-check.

## P6 verification

- `npm --prefix backend run typecheck`
- `npx tsx src/modules/vaults/assert-vault.ts` + treasury/windows/pools/partner/autofire asserts (list exact files, run all `assert-*.ts` touched)
- `npm --prefix frontend run typecheck`
- OpenAPI↔DTO↔lib/api consistency: `depositor` optional, settle ADMIN, deposit/withdraw 401.
- Review: `nestjs-code-reviewer` findings-only, verdict APPROVE before tracker done.

## Stop conditions

- Any phase typecheck/assert red twice → stop, record blocker.
- If `$transaction` mock breaks >2 asserts → stop, reconsider tx seam (pass-through wrapper).
- If FE anon-deposit flow breaks demo smoke → stop, add compat flag per intent D4 fallback.
