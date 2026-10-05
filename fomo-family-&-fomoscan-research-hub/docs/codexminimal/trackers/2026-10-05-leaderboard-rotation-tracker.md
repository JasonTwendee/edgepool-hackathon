# Tracker — Leaderboard rotation

- Topic: leaderboard-rotation
- Intent: `docs/codexminimal/idsd/2026-10-05-leaderboard-rotation-intent.md`
- Started: 2026-10-05

## Phases

- [x] R1 client leaderboard period + rotation service + asserts: `done`
  (period param daily|weekly|monthly + `assert-leaderboard.ts` 6 groups GREEN;
  `LeaderboardService.tick` add/reactivate/deactivate/prune + module wired)
- [x] R2 tick endpoint + daily loop + remove manual add/remove (BE+FE+openapi): `done`
  (`GET/POST /api/wallets/rotation/*` ADMIN+audited; loop 24h default;
  removed POST /api/wallets, DELETE :address, FE Add/Remove, lib fns, CreateWalletDto;
  openapi 44 paths YAML valid; tsc BE+FE ✅; env contract ✅)
- [x] R3 live rotation on server + review: `done`
  (live tick: added 3, deactivated 10, total 30, active 20 current weekly top;
  old wallets inactive w/ history; FE lists active only + `isActive` in API;
  enrich-all 403 transient → leaderboard wallet authoritative, enrich best-effort;
  reviewer APPROVE)

## Review gate — APPROVE

Rotation math verified (assert + live); cap/prune safe (inactive-only);
no forced cash-out (manage tick owns exits); manual routes fully removed
(BE+FE+openapi); quota-safe (daily 1 call + throttle). Protected
copy-trade/** untouched. Follow-up: P3 thesis/WS, auto-assign vault traders.

## Handoff log

- 2026-10-05: intake xong (daily auto, no forced cash-out, cap-50 prune oldest-inactive).
- 2026-10-05: R1–R3 đóng. Server live tick + FE active-only + deploy.
