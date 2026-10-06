# IDSD Intent — Vault Money Hardening 1–6 (real-money blockers)

Date: 2026-10-06
Topic: vault-money-hardening-1-6
Stage: intent-approved (user approved full 1–6, incl. protected `copy-trade/**` + DB + API contract break)
Tracker: to be created by repo-phase-orchestrator

## 1. Intent contract

**Intent:** Close 6 critical money vulnerabilities so vault accounting can hold real funds. Accounting math (HWM, shares, fee) stays untouched — only guards, atomicity, identity, split, halt.

**Scope (in):**
1. Settle guard: `POST /api/vaults/settle` → ADMIN-only + audit, engine NAV default.
2. Settle atomic: all settle writes in one `prisma.$transaction` + advisory lock.
3. Settle race: same lock prevents double-mint/double-burn (idempotent retry via tx-rollback + HWM ratchet).
4. Identity: deposit/withdraw derive identity from session, ignore client `depositor` string.
5. Fee split by kind: basket 50/50, partner 75/25 (of fee).
6. Kill-switch enforce: auto-fire halts vault on day −5% / week −15% (rulesJson overridable), sets `paused` + audit.

**Non-goals (out):**
- 7–13 (payout-wallet verify, mainnet execution, oracle staleness, prune guards, rate-limit, max-deposit) — later phases.
- Multisig 2-người cho settle — v1 chỉ ADMIN + audit (multisig là follow-up).
- On-chain settlement / SPL shares — off-chain paper vẫn là source of truth.

**Constraints:**
- BE: NestJS, tsx-safe `@Inject()`, `validateDto()` explicit, error envelope `{success:false,message}`.
- Protected path `backend/src/modules/copy-trade/**` — approved 2026-10-06 for fix 6 only (auto-fire halt, no execution-logic change).
- No `.env` / `backend/src/config/*` prod-value edits.
- `docs/api/openapi.yaml` is contract source of truth — update settle/deposit/withdraw sections.
- FE `lib/api.ts` must match new contract (depositor optional, token required).
- Asserts must stay green: `assert-vault.ts`, `assert-treasury.ts`, `assert-windows.ts`, `assert-pools.ts`, `assert-partner.ts`, `assert-autofire.ts`.

## 2. Architecture decisions (ADR-short)

- **D1 settle-guard:** `POST /api/vaults/settle` gets `AuthGuard+RolesGuard(ADMIN)` + `AuditInterceptor(@Audit('vault.settle'))`. `navSol` kept OPTIONAL for asserts/back-compat; when omitted → `computeNav()` engine. Manual NAV allowed only for ADMIN and is audit-logged with reason. *Why not remove param:* asserts + manual ops need it; guard + audit closes exploit without breaking tests.
- **D2 atomic-settle:** Wrap entire `settleEpoch` body in `prisma.$transaction(async tx => ...)`, first statement `SELECT pg_advisory_xact_lock(hashtext('vault-settle-<id>'))`. All reads/writes use `tx`. *Why advisory xact lock, no schema migration:* auto-releases on commit/rollback, survives multi-instance, no new column to backfill. Crash mid-tx → rollback → retry safe.
- **D3 idempotency-v1:** No new idempotency column. Guarantees: (a) tx rollback → no partial ledger, (b) HWM ratchet → retry on same NAV charges fee 0, (c) empty-queue settle is a no-op epoch (fee 0, no mint/burn). Full idempotency-key column deferred to follow-up.
- **D4 identity:** `deposit`/`withdraw` require `AuthGuard` (401 without session). Service signature becomes `deposit(vaultId, sessionUser, amountSol, displayName?)`. `depositor` string kept as display-only (defaults to `user.wallet`), `userId` always set. `depositorShares`/`mine`/`cancelWithdraw` already match `OR(userId, depositor=wallet)` — new rows always hit by userId. Breaking change: anonymous `depositor:'me'` calls now 401; FE updated to stop sending fake names.
- **D5 fee-split:** `bookFeeSplit(vaultId, epochId, feeSol)` loads `vault.kind`; `partnerShare = kind==='partner' ? 0.75 : 0.5` (basket default, assert kind in set). Aligns with `PartnerService.fees()` line 172 (`0.75 vs 0.5`). Dust → treasury (existing `f9`/`r9` conservation).
- **D6 kill-switch:** `AutoFireService.tick()` checks per-vault loss before firing: `dayPct/weekPct` from epoch checkpoints (same `navAt` logic as `advancedView`). Limits: `rulesJson.dailyKillSwitchPct ?? 5`, `rulesJson.weeklyLossLimitPct ?? 15`. Breach → skip vault signals, `audit.record('copy.kill_switch_halt')`, set `vault.status='paused'` (ADMIN unpause via existing settings). `status='paused'` vaults never fire. Settle/withdraw continue (redemptions must not halt).

## 3. Bounded specification

### F1 settle guard (controller)
- `vaults.controller.ts:149` → add `@UseGuards(AuthGuard, RolesGuard) @Roles('ADMIN') @UseInterceptors(AuditInterceptor) @Audit('vault.settle')`.
- `VaultSettleDto.navSol` stays optional; add optional `reason: string (min 3)` for audit (consistent with CreateVaultDto/AssignTraderDto pattern).
- OpenAPI: mark `/api/vaults/settle` as ADMIN, note engine-NAV default.

### F2+F3 atomic + lock (service)
- `vault.service.ts:settleEpoch` → `return this.prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(...)`; ... all prisma.X → tx.X ... })`.
- Window-gate, price, fee, deposit-loop, withdraw-loop, vault-update, epoch-create, bookFeeSplit all inside tx. `bookFeeSplit` takes `tx` param.
- Concurrent second settle blocks on advisory lock (serializes), no double-mint.
- Keep `windowState` pure export untouched.

### F4 identity (controller+service+dto+FE)
- DTO: `VaultDepositDto.depositor?`, `VaultWithdrawDto.depositor?` (optional, display-only).
- Controller `deposit`/`withdraw` → `@UseGuards(AuthGuard)`, pass `req.user` to service, ignore forged `depositor` except as display fallback.
- Service: `deposit(vaultId, user:{id,wallet}, amountSol)`, `requestWithdraw(vaultId, user, shares)`. Slot-check `isHolder` by `OR(userId, depositor=wallet)`. Withdraw balance via user-scoped `depositorSharesByUser`.
- FE `lib/api.ts`: `queueVaultDeposit({amountSol,vaultId}, token)` — drop fake `depositor:'me'`; `MyVault.tsx`, `portfolio/page.tsx`, `pools/[id]/page.tsx` updated to session wallet display.
- OpenAPI: `depositor` optional, `401` added for deposit/withdraw.

### F5 fee split
- `PARTNER_FEE_SHARE` stays as partner-kind constant; add `BASKET_FEE_SHARE = 0.5`.
- `bookFeeSplit` loads kind, branches, asserts. `fees()` in partner.service already correct — no change.

### F6 kill-switch
- `auto-fire.service.ts:tick()` → per-`botVault`: load vault (`status`, `rulesJson`), load epochs for day/week pct, if `paused` → skip + `blocked++`; if breach → `prisma.vault.update(status:'paused')`, `audit.record('copy.kill_switch_halt')`, skip vault, continue others. Summary adds `haltedVaults: number[]`.
- `assert-autofire.ts` extended with halt case (mocked epochs).

## 4. Task breakdown (for repo-phase-orchestrator)

- P1: F1 guard + DTO reason + openapi + audit e2e (settle 401 anon, 403 USER, 200 ADMIN+audit row).
- P2: F2+F3 tx + advisory lock (mock-tx assert + concurrent-settle test).
- P3: F4 identity (DTO optional, controller AuthGuard, service user-scoped, FE 3 call-sites, openapi 401).
- P4: F5 split-by-kind (service branch + assert basket 50/50 vs partner 75/25).
- P5: F6 kill-switch (tick halt, paused skip, audit, summary field + assert).
- P6: Full verify: `npm --prefix backend run typecheck`, targeted asserts, FE `tsc`, openapi↔DTO↔lib/api consistency check.

## 5. Test contract (executable evidence)

- `npx tsx src/modules/vaults/assert-vault.ts` — must stay GREEN (HWM/shares math untouched).
- New/updated asserts:
  - settle guard: controller has AuthGuard+Roles(ADMIN)+Audit metadata (static check or e2e 401/403).
  - atomic: mocked tx — all writes via same tx client; failure mid-loop rolls back (no partial deposit SETTLED).
  - race: two concurrent `settleEpoch` on same vault with QUEUED → total minted == single-settle amount (advisory lock serializes).
  - identity: `deposit(vault, attackerSession, ...)` cannot touch victim shares; `requestWithdraw` with victim display-name but attacker session → checks attacker balance only.
  - split: fee 1.0 on basket → partner 0.5 / edgepool 0.5; on partner → 0.75/0.25 (conservation `payouts+edgepool==fee`).
  - kill-switch: epochs showing −6% day → `tick()` fires 0 for that vault, status → paused, audit row written.
- Typecheck: `npm run typecheck` (BE+FE) green. No `.env` touched.

## 6. Agent cards (minimal)

- `nestjs-bug-fixer` (BE vaults + auto-fire fixes, repro → smallest fix → regression assert).
- `nestjs-code-reviewer` (pre-merge: DTO boundaries, tx safety, auth, audit coverage).
- `project-indexer` (after landing: refresh indexes + context-map routes for settle/deposit/withdraw).

## 7. Acceptance evidence

- [ ] `POST /api/vaults/settle` anon → 401, USER → 403, ADMIN → 200 + `audit_logs` row `vault.settle`.
- [ ] Omitted `navSol` settles at engine NAV; manual `navSol` only works as ADMIN.
- [ ] Crash-mid-settle (injected throw) leaves zero partial writes; retry charges fee once.
- [ ] 2 concurrent settles → single mint total.
- [ ] Attacker session + victim display-name cannot withdraw victim shares.
- [ ] Basket fee 50/50, partner 75/25, conservation holds.
- [ ] −5%/day or −15%/week vault → auto-fire skips + pauses + audits; redemptions still settle.
- [ ] `npm run typecheck` green; vault asserts green.

## 8. Protected-file / risk concerns

- `backend/src/modules/copy-trade/auto-fire.service.ts` — APPROVED 2026-10-06 (halt-check only, no execution/413 change). Reviewer must confirm no sizing/venue/confirm-path touched.
- API break: deposit/withdraw now 401-anon — FE + docs updated in same phase; smoke must cover signed-in deposit flow.
- No migration in v1 (advisory lock, no new columns) — keeps deploy low-risk; idempotency-key column deferred.

## 9. Next skill

`repo-phase-orchestrator` — write phase plan + tracker at `docs/codexminimal/trackers/2026-10-06-vault-money-hardening-1-6-tracker.md`, then native execution P1→P6.

## 10. Follow-up chain

`repo-phase-orchestrator` → native execution (`nestjs-bug-fixer` for code, `nestjs-code-reviewer` pre-merge) → `project-indexer`.

## 11. Stop condition

Phase plan + tracker exist and P1–P5 code + P6 verification are done with acceptance evidence above. Stop and report if any assert/typecheck fails twice or a new migration becomes unavoidable.
