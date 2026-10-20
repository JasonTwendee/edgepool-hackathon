# Tracker — Two-Pool Live Scope + Load Slimming

Topic: `two-pool-live-scope-slimming`
Intent: `docs/codexminimal/idsd/2026-10-20-two-pool-live-scope-slimming-intent.md`
Plan: `docs/codexminimal/plans/2026-10-20-two-pool-live-scope-slimming-phase-plan.md`

## Status

| Phase | Status | Scope | Evidence |
|---|---|---|---|
| P0 | done | Baseline metrics + roster snapshot | 9 pools / 33 trader rows / 12 unique wallets; 30 active tracked; 14,685 events/h; DB 5.2 GB events + 2.8 GB tx |
| P0 | done | VPS backup before destructive cleanup | `/home/ubuntu/backups/pre-two-pool-20261020T075953Z.dump` (79K, 128 restore entries) |
| P1 | done | Live-scope resolver + stream/wallet reconcile + rotation pin + roster sync | `common/live-scope.ts`, `wallets.service.ts` reconcile loop, `solana-stream.service.ts resetTo`, rotation pin + shared roster |
| P2 | done | Debounce + scoped stats + SSE buffer + watchdog | `LIVE_DEBOUNCE_MS=3000`, `findAllLive` sync, `syncWalletStats(days, addresses)`, 500ms SSE buffer, 30-min watchdog |
| P3 | done | Asserts + typecheck + builds + env contract | 28/28 assert suites; BE typecheck+build; FE typecheck+build; env contract 56+2; openapi 70 paths |
| P4 | done | VPS cleanup to 2 pools | 7 vaults deleted; 41 orders / 7 intents / 7 bots cleaned; 14/15 share 5×2000bps; NAV unchanged |
| P5 | done | Deploy + live metrics/smoke | deployed `a29afcf` → `059d1ad` → `1bff5e5`; subs=5, sync=5, stats=4; **8 events 08:18–08:47 (~16.5/h vs 14,685/h, −99.89%)**, only top-5 wallets; 2 pools shared 5×2000bps; FE/BE smoke green; load 0.44 / RAM 819MB / 0 locks; retention 120d |
| P6 | done | Docs/indexes/logs | intent+plan+tracker, refactor-log, rule-registry, context-map, project/test/module/entity indexes, artifact registry, telemetry |
| P7 | done | Display only 5 + trim raw ledger/events outside roster | `/api/wallets`=5, PnL overview=5, `LEADERBOARD_TOP_N=5`, live-only rotation; DB **8.17 GB → 66 MB**; tx **5,067,447 → 48,189**; events **4,866,031 → 14,429**; tracked wallets **100 → 11**; orphan FK=0 |

## Baseline (2026-10-20)

### Pools

| id | name | kind | listing | shares | max traders | keep |
|---|---|---|---|---|---|---|
| 1 | Edgepool Basket 01 | basket | unlisted | 13.2432 | 5 | no |
| 14 | KOL Star Pool | partner | public | 10.0000 | 3 | **yes (KOL)** |
| 15 | Edgepool Flagship Basket | basket | public | 424.9242 | 5 | **yes (user)** |
| 16 | Kestrel Collective | partner | public | 85.9757 | 5 | no |
| 17 | Quill Rotation | partner | public | 55.0000 | 5 | no |
| 35–38 | demo-* | basket | unlisted | 11–13.2 | 5 | no |

### Top 5 roster (rank_24h among curated public-pool traders)

| # | handle | rank24h | rank7d | rank30d |
|---|---|---|---|---|
| 1 | Aurelius | 1 | 2 | 13 |
| 2 | collectible | 7 | 56 | 46 |
| 3 | throatycrab1008 | 20 | 6 | 1 |
| 4 | ogantd | 24 | 14 | 2 |
| 5 | Cirrus | 27 | 42 | 63 |

### Live load

- 30 active tracked wallets, 39 WS subs.
- 14,685 `realtime_events`/hour; `trunoest` 7,591 (no pool), `notdecu` 6,863
  (pool 17), other 28 = 231 (1.6%).
- `realtime_events`: 4.86M rows / 5.2 GB; `transactions`: 5.06M / 2.8 GB.
- Growth ~0.4–0.5 GB/day; VPS ~20 GB free.

## Residual notes / follow-ups

- The first scoped boot ran with the server's stale `FULL_HISTORY_DAYS=35`
  before it was corrected to 120; `pruneOnce` archived+deleted **23** raw rows
  older than 35 days (audit `sync.prune_archive`). Raw chain data is
  re-fetchable from RPC; no money-ledger row is in prune scope.
- Pool 15 still has closed copy orders from `sadcrissy` (2) and is otherwise
  clean; pool 14 has 3 open orders from `throatycrab1008` (still in roster).
  No open position belongs to a removed trader.
- `LIVE_ROSTER_MODE=top` would follow the board top 5 (may include high-volume
  wallets). Keep `pin` unless the user explicitly wants dynamic board churn.
- Leaderboard display keeps only 5 rows; only the 5 pool traders are live
  (WS/sync/stats). This is the requested product surface.
- On-demand `GET /api/portfolio/pnl/overview` is now scoped to the 5 live
  wallets, so the terminal sidebar no longer FIFO-scans 100 wallets.

## Handoff log

- 2026-10-20: baseline captured; intent + plan + tracker created.
- 2026-10-20 P0 done: backup `pre-two-pool-20261020T075953Z.dump` (12 tables,
  128 entries) on `edgepool-dev`.
- 2026-10-20 P1 done: `resolveLiveScope` (public+live vault traders, fallback
  all), 60s wallet/stream reconcile, `SolanaStream.resetTo`, rotation pins live
  wallets and re-syncs both public pools to the same best-5 basket. Rotation no
  longer re-subscribes the display board. New asserts 12/13 cover pin + roster.
- 2026-10-20 P2 done: per-wallet debouncer (3s), sync/stats scoped to
  `findAllLive`, SSE 500ms bounded buffer, watchdog stale 30min + proper
  unsubscribe (old code leaked listeners on resubscribe).
- 2026-10-20 P3 done: 28/28 assert suites green; BE typecheck+build green;
  FE typecheck+build green; env contract 56 backend + 2 frontend; openapi 70.
- 2026-10-20 P4 done (VPS): deleted vaults 1,16,17,35,36,37,38; cleaned 41
  copy orders, 7 signed intents, 7 bots; pools 14/15 now each 5 traders
  (2000 bps) with the same addresses; pool 14 max_traders 3→5; NAV unchanged
  (14: 10.0 @1.0; 15: 431.87 @1.016345957). Inactive old trader rows kept for
  history/fee audit.
- 2026-10-20 P5 done: 29-min post-scope window (08:18–08:47): **8
  `realtime_events`** (~16.5/h) vs baseline 14,685/h = **−99.89%**; wallets
  only `ogantd` (5), `collectible` (2), `Aurelius` (1). `transactions` +8.
  Load 0.44, RAM used 819 MB, 0 ungranted locks, DB 8.17 GB / 20 GB free.
  Live subs=5, sync wallets=5, statsUpdated=4. Public pools API + pool detail
  14/15 + 6 FE routes 200; auth-gated 401; SSE `CONNECTED`; tailnet health 200.
- 2026-10-20 P6 done: docs/indexes/rule-registry/context-map/artifact
  registry/telemetry updated in the same commit as the final watchdog comments.
- 2026-10-20 P7 done (user follow-up): display surface narrowed to the 5 live
  pool traders — `GET /api/wallets` and PnL overview use `findAllLive()`;
  `LEADERBOARD_TOP_N=5` (cap 20) in code + VPS `.env`; rotation only activates
  the live roster (`LIVE_ROSTER_MODE=pin`). Raw ledger/events for wallets
  outside the roster were trimmed in one locked transaction:
  `transactions` 5,067,447 → **48,189**, `realtime_events` 4,866,031 →
  **14,429**, DB **8.17 GB → 66 MB**. Kept rows are exactly the 5 roster
  wallets; event→tx orphan check = 0; money ledger/orders/audit untouched.
  Then removed **12 empty inactive tracked wallets** (no tx/event/open order/
  active trader): `tracked_wallets` 100 → **11** (5 live + 6 inactive history;
  3 of them keep legacy open orders).
- 2026-10-20: server `.env` `FULL_HISTORY_DAYS` corrected 35 → 120 per user
  confirmation; the temporary `.env` backup was removed after verification.
