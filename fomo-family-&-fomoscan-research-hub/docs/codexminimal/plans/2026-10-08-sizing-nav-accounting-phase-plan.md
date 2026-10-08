# Sizing and NAV accounting repair

Outcome: paper copy orders use their actual allocation, and settlements preserve SOL NAV across partial exits, deposits, withdrawals and repeated epochs.

Constraints: preserve existing risk percentages and API envelopes; keep paper/devnet execution; use a separate local test database; never rewrite applied migrations or production data. User authorized BE sizing/accounting implementation and Docker test services on 2026-10-08.

Non-goals: mainnet execution, custody, UI changes, raising caps, deployment.

Acceptance: regression asserts for 1 SOL sizing and cap boundaries; consistent quote/order allocation; USD-to-SOL NAV conversion; partial exits; unchanged prices across repeated epochs; deposit/withdraw conservation; real Postgres settlement concurrency; backend typecheck/build and affected suites.

## Phases

- [x] Reproduce sizing and NAV faults with focused regression cases.
- [x] Repair actual copy sizing and remaining exposure.
- [x] Add nullable PnL checkpoint migration; repair NAV and cash outflows. Historical epochs with pre-existing trades require explicit reviewed NAV settlement to establish a baseline.
- [x] Run asserts, migration on isolated Postgres, integration checks and backend compile/build.
- [x] Review and update owning documentation with migration and legacy-baseline requirements.

Implementation: `backend/src/modules/copy-trade/copy-trade.service.ts`, vault service and focused asserts; `backend/prisma/schema.prisma` plus a new migration. Do not modify production configuration.

Rollback: revert application changes together; the additive nullable column may remain. Test container is task-owned and stopped on completion.


## Verification and review

- Original regressions reproduced: 1 SOL copy rejected source notional; 10 SOL NAV + $7 PnL returned 17 instead of 10.07 at $100/SOL.
- 26/26 assert suites passed. Backend typecheck and build passed.
- All 24 migrations applied successfully to task-owned Postgres 17 on localhost:55433.
- Real DB verification passed concurrent deposit mint/withdraw burn, partial exits, repeated epochs, deposits, full redemption with withdrawal fee, single performance fee, rollback after injected post-write failure, historical-baseline refusal/rebaseline and absent price refusal.
- Postgres exposed a pre-existing Prisma void-deserialization failure in the advisory lock query; cast the result to text and no longer swallow lock failures.
- Simplifier ran on three owned production files; inline code review checked affected callers, formulas, public envelopes, migration compatibility and task-owned process cleanup. This is not an external money-safety audit.
- OpenAPI YAML parses and git diff has no whitespace errors. Quoted a pre-existing flow-scalar description so YAML parsing succeeds.
- No deployment, live balances or mainnet transactions changed. Historical pool NAV must be reviewed before establishing the nullable PnL baseline; this migration does not backfill balances.
