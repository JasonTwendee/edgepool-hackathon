# Tracker — TP ladder + trailing-stop

- Topic: ladder
- Intent: `docs/codexminimal/idsd/2026-10-02-ladder-intent.md`
- Started: 2026-10-02
- Approval: user 2026-10-02 (trailing/ladder paper-only)

## Phases

- [x] L1 schema + migration: `done` (`CopyOrderLeg` + relation + migration;
  1 sự cố drift do sửa migration đã apply — revert + backfill tay, ghi rule)
- [x] L2 engine legs + history legs: `done` (TP1 50% @target / TP2 remainder @2× /
  TRAIL 20% post-TP1 / STOP+TIME remainder @market; legs trong history)
- [x] L3 asserts + live + regression + review: `done` (`assert-manage.ts` GREEN
  11 cases; live tick 3 HOLDs + `legs:[]` trong history; 10/10 asserts GREEN;
  root tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

Legs table queryable (không nhét JSON); TP @target / stop-time-trail @market
(ghi quy ước); SELL mirror qua move signed; idempotent; orders cũ không legs
(remaining=1); history additive `legs`. Paper-only, không path mainnet.

## Handoff log

- 2026-10-02: intake xong (legs table, target-fill quy ước, constants).
- 2026-10-02: L1–L3 đóng.
