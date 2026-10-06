# Tracker — Vault Money Hardening 1–6

Topic: vault-money-hardening-1-6 | Intent: `docs/codexminimal/idsd/2026-10-06-vault-money-hardening-1-6-intent.md` | Plan: `docs/codexminimal/plans/2026-10-06-vault-money-hardening-1-6-phase-plan.md`

## Status

- [x] P1 settle guard
- [x] P2 atomic + lock
- [x] P3 identity
- [x] P4 fee split
- [x] P5 kill-switch
- [x] P6 verify + review

## Handoff log

- 2026-10-06: intent approved (full 1–6, protected copy-trade/** approved). Plan written. Starting P1 native execution.
- 2026-10-06 P1 done: `vaults.controller:settle` ADMIN-only + `vault.settle` audit + `VaultSettleDto.reason?`; openapi settle ADMIN + 401/403.
- 2026-10-06 P2 done: `settleEpoch` wrapped in `prisma.$transaction` + `pg_advisory_xact_lock(vault-settle-<id>)`; pricing outside tx; withdraw balance read inside tx; mock fallback when `$transaction` missing.
- 2026-10-06 P3 done: deposit/withdraw `AuthGuard` + session identity authoritative (`depositor` display-only optional); `depositorSharesByUser`; slot-check user-aware; FE `lib/api` token-required + 3 call-sites de-forged; openapi 401 + depositor optional.
- 2026-10-06 P4 done: `bookFeeSplit(tx)` branches `partner 0.75 / basket 0.5`, asserts kind, conservation kept; `assert-partner` now partner-default + new basket 50/50 case.
- 2026-10-06 P5 done (protected, approved): `AutoFireService.tick` kill-switch per vault (day/week loss from epochs, rulesJson override, pause + `copy.kill_switch_halt` audit, `haltedVaults` in summary); `assert-autofire` +2 halt cases.
- 2026-10-06 P6 done: BE+FE typecheck green; 14/14 assert suites green (vault/treasury/windows/pools/portfolio/multivault/partner×2/alloc/autofire/manage/paper-executor/auth/audit); openapi YAML valid.

## Review verdict

APPROVE (nestjs-code-reviewer findings-only self-review):
- Controllers thin, services own logic; DTO `validateDto` explicit; envelope preserved via `fail()`.
- Tx covers all ledger writes; advisory xact lock serializes races; HWM ratchet keeps retry fee-0.
- Identity: controller no longer forwards client string; string overload retained only for ADMIN demo seed + asserts (server-side, not user input).
- Fee split aligns with `PartnerService.fees()` (0.75 vs 0.5); dust to treasury.
- Auto-fire diff limited to halt-check (no sizing/venue/confirm touched); paused vaults skip; settle/withdraw unaffected.
- Protected-file: `copy-trade/auto-fire.service.ts` change within approved halt scope. No `.env`/`config/*` touched.

## Test gaps / follow-up

- No live-DB concurrency test (advisory lock verified by code + mock, not 2-conn E2E) — recommend staging E2E with 2 parallel settles before real money.
- No idempotency-key column (deferred per D3; tx+HWM covers v1).
- FE anon-deposit now 401 — demo smoke must use signed-in flow.

## Next phase

None for 1–6. Suggested next: 7 (payout-wallet verify) → 10+11 (prune guards) → 8/9/12/13 per audit order. Awaiting user direction.
