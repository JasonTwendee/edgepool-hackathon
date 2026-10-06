# Tracker — Pool app P1

- Topic: pool-p1
- Intent: `docs/codexminimal/idsd/2026-10-06-pool-p1-intent.md`
- Started: 2026-10-06

## Phases

- [x] P1.1 pool fields + migration + list endpoint: `done`
  (kind/status/listing/maxSlots/maxTraders + `GET /api/vaults/pools` + assert-pools GREEN)
- [x] P1.2 NAV engine (MTM) + settle optional nav: `done`
  (computeNav + CopyOrder.vaultId + settle navSol optional + openapi)
- [x] P1.3 seed basket + partner demo: `done`
  (vault 1 → Edgepool Basket 01 + 5 traders + basket-bot-01 AUTO;
  vault 14 Partner Demo 01 kind=partner + 3 traders + partner-bot-01 AUTO)
- [x] P1.4 FE pools index + /terminal move: `done`
  (tokens.css, pools `/`, terminal moved, tsc + build xanh)
- [x] P1.5 asserts + contract + live verify: `done`
  (assert-pools GREEN; openapi 46 paths; live pools + terminal 200;
  reviewer APPROVE)

## Review gate — APPROVE

## Handoff log

- 2026-10-06: intake xong (1 pool = vault+bot+3-5 traders; NAV engine lấp gap nhập tay).
- 2026-10-06: P1.1–P1.5 đóng. Live: 2 pools + terminal song song.
