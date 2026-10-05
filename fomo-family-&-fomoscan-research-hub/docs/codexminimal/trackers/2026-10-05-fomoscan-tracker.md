# Tracker — FomoScan P0–P2

- Topic: fomoscan
- Intent: `docs/codexminimal/idsd/2026-10-05-fomoscan-intent.md`
- Started: 2026-10-05

## Phases

- [x] F1 P0 client + env + asserts: `done`
  (throttled ≥1.1s + TTL cache + FetchLike mocks; `assert-fomoscan.ts` GREEN;
  `FOMOSCAN_API_KEY/BASE_URL/PNL_PRIMARY` in contract)
- [x] F2 P1 enrich + cross-check: `done`
  (migration bio/evm + regen; `POST :address/enrich` ADMIN+audited; 404 clean
  cho ví chưa verified; `assert-enrich.ts` GREEN; `GET /api/portfolio/fomoscan`
  ADMIN; 41→42 paths YAML valid)
- [x] F3 P2 fast-path flag: `done` (default false; failure → local FIFO; no FE change)
- [x] F4 key + live + review: `done`
  (live: 4/10 wallets enriched — FomoScan chỉ cover verified traders;
  cross-check unipcs 30d: local -1073 vs fomoscan -37169 → methodology khác xa,
  GIỮ flag false; reviewer APPROVE)

## Review gate — APPROVE

Quota-safe (throttle+cache); enrich never-blanks; fast-path additive + flagged;
key server-only. Không đụng copy-trade/config. Follow-up: P3 thesis/WS, leaderboard
discovery, EVM reads.

## Handoff log

- 2026-10-05: intake xong (18 paths verified, unipcs byte-match, flag-gated fast-path).
- 2026-10-05: F1–F4 đóng. Key trên server .env (600). BE+FE rebuild + live enrich.
