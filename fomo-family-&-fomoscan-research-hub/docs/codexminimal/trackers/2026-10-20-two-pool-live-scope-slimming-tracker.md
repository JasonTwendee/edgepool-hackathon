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
| P5 | in progress | Deploy + live metrics/smoke | deployed `a29afcf` + `059d1ad`; subs=5, sync=5, stats=4; 3 events 08:18–08:28 (vs 14,685/h); 2 pools shared 5×2000bps; FE/BE smoke green; load 1.24 / 0 locks; retention 120d re-confirmed |
| P6 | pending | Docs/indexes/logs | — |

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
- 2026-10-20 P5 partial: deployed `a29afcf` then watchdog fix `059d1ad`.
  Runtime logs: `live scope: 5 wallet(s), subs=5`, `Wallets live scope=pool
  wallets=5`, `SyncScheduler (boot) wallets=5 statsUpdated=4`, retention log
  `120d window`. Public `GET /api/vaults/pools` = 2 pools, both 5 traders
  × 2000bps. Events 08:18–08:28 = 3 (all ogantd/collectible). FE 6 routes 200,
  BE 200, auth 401. Load 1.24, 0 ungranted locks, DB 8.17 GB / 20 GB free.
  Fixed watchdog: `lastMsgAt` is armed only on real subscription changes, not
  every 60s reconcile (otherwise a dead socket would never be detected); no
  quiet-resubscribe churn observed.
- 2026-10-20: server `.env` `FULL_HISTORY_DAYS` corrected 35 → 120 per user
  confirmation; backup `.env.bak-20261020-retention` left on VPS.
