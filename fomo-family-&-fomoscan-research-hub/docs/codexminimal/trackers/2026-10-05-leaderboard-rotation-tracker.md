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
- [ ] R3 live rotation on server + review: `open`

## Handoff log

- 2026-10-05: intake xong (daily auto, no forced cash-out, cap-50 prune oldest-inactive).
