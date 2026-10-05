# Tracker — T1 auto-fire engine

- Topic: t1-autofire
- Intent: `docs/codexminimal/idsd/2026-10-02-t1-autofire-intent.md`
- Plan: `docs/codexminimal/plans/2026-10-02-t1-autofire-phase-plan.md`
- Started: 2026-10-02
- Approval: user 2026-10-02 (sửa `copy-trade/**`, devnet/paper-only, giữ 1-click)

## Phases

- [x] T1.1 executePaper overrides: `done` (vaultId sizing + triggeredBy in quoteJson.sized)
- [x] T1.2 AutoFireService + asserts: `done` (`assert-autofire.ts` GREEN: no-AUTO/PAUSED/dedupe/fire+audit/cap/loop-kill)
- [x] T1.3 tick endpoint + contract: `done` (ADMIN+Audit endpoint, openapi 29 paths valid, `.env.example` loop key, watch-signals comment)
- [x] T1.4 live smoke + regression + review: `done` (live tick: scanned 12, fired 2 CONFIRMED + 1 blocked; history `triggeredBy` ✓; PAUSED silent; 1-click gate intact; fix shared-array bug; tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

Controller thin; AuditModule import đúng rule; paper-only qua executePaper
(devnet-check bên trong, không path mainnet mới); dedupe pre-check (ghi rõ giả định
single-writer); loop có guard + unref + kill-switch env.

## Handoff log

- 2026-10-02: intake xong (poll design, first-match, triggeredBy, loop 5'/kill-switch).
- 2026-10-02: T1.1–T1.4 đóng. Live order #8/#9 là auto-fire thật đầu tiên (actor bot).
