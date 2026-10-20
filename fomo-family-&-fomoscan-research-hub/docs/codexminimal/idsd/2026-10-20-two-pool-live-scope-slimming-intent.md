# Intent — Two-Pool Live Scope + Load Slimming

- Date: 2026-10-20
- Topic: `two-pool-live-scope-slimming`
- Status: approved for implementation
- Owner approvals (2026-10-20 chat):
  1. Both pools use the **same 5 wallets**; selection criteria identical.
  2. KOL pool = `partner` 75/25 fee split; user pool = `basket` 50/50.
  3. Delete the other pools to reduce load.
  4. Keep history retention at **120 days**.
  5. Apply WS scoping, per-wallet debounce, dirty/scope stats, SSE throttle.

## 1. Problem

The live pipeline still follows 30 active tracked wallets even though only pool
traders are product-relevant. Measured baseline (2026-10-20):

- 39 WS subscriptions / 30 DB-active wallets.
- 14,685 `realtime_events` in the last hour.
- `trunoest` (not in any pool) = 7,591 events/h; `notdecu` (pool 17) = 6,863/h.
- Those two wallets generated **98.4%** of live events.
- `realtime_events` = 4.86M rows / 5.2 GB; `transactions` = 5.06M / 2.8 GB.
- Growth ~0.4–0.5 GB/day on a 2 GB RAM VPS with ~20 GB free.

## 2. Target state

Exactly two public pools:

| Role | Vault | Kind | Profit/fee rule | Traders |
|---|---|---|---|---|
| KOL pool | `14` KOL Star Pool | `partner` | 75% trader / 25% Edgepool of performance fee (15%/5% of profit) | same 5 wallets |
| User pool | `15` Edgepool Flagship Basket | `basket` | 50/50 (10% traders / 10% Edgepool of profit) | same 5 wallets |

Roster (top 5 by `rank_24h` among current curated public-pool traders, tie
`rank_7d` → `rank_30d` → `cumulative_pnl_usd` → address):

1. `Aurelius` — `9BMzTpSo4URse1oN666pmexhdjpU1vA5p7LtroCFQdLU` (rank 1)
2. `collectible` — `EnPjBjzy6zaufzpZ2m3Q8nPS3KpyiRxNLKtcSiMYwWCa` (rank 7)
3. `throatycrab1008` — `29yFzeBZgxf5zqrAkKXwgZtQehRf4pL8WbV2nRJikbw8` (rank 20)
4. `ogantd` — `215nhcAHjQQGgwpQSJQ7zR26etbjjtVdW74NLzwEgQjP` (rank 24)
5. `Cirrus` — `f4CMmXJCRu4fzyqZPkDiFhGKAeCo1s7sxUtPKQp9SDy` (rank 27)

Both pools use equal weights (`2000` bps each) and `max_traders = 5`.

Delete pools `1`, `16`, `17`, `35`, `36`, `37`, `38` (and their bots/copy
orders/signed intents). Keep pools `14`, `15` and their deposits/withdrawals/
epoch history.

## 3. Runtime rules (durable)

1. **Live scope = active traders of public, live pools.** WS subscriptions,
   RPC safety-net sync, and PnL stats run only for this set.
   `LIVE_SCOPE_MODE=pool` (default). Fallback to DB-active wallets only when the
   pool roster is empty (bootstrap/dev).
2. **Roster is pinned.** Leaderboard rotation may refresh ranks and the
   top-20 display universe, but must not unsubscribe or deactivate a live pool
   trader. Both public pools are re-synced to the same 5 wallets at the end of
   each rotation.
3. **Debounce.** WS activity per wallet is coalesced (`LIVE_DEBOUNCE_MS=3000`)
   before fetch/enrich/persist. Safety-net sync remains the correctness net.
4. **Stats.** PnL recompute only for live-scope wallets, at most every
   `SYNC_STATS_INTERVAL_MS` (300000) or when fresh tx exists.
5. **SSE.** Client fan-out is buffered/coalesced at `SSE_FLUSH_MS=500`; no DB
   work is added per client.
6. **Retention stays 120 days** (`FULL_HISTORY_DAYS=120`). No prune scope
   expansion. Money ledger tables are never pruned.
7. **Money paths unchanged**: per-depositor withdrawal scope + supply guards
   from commits `8fd94bf` / `9488da9` stay intact.

## 4. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | Keep vault `14` as KOL and `15` as user pool | Existing public pools with history; no need to recreate |
| D2 | Same 5 wallets in both pools | User requirement; only profit formula differs |
| D3 | Equal `weight_bps=2000` | No per-trader weighting requested |
| D4 | Scope live pipeline by `vault_traders` join public/live vaults | Directly encodes "only pool traders" without a new config table |
| D5 | Rotation pins live traders active | Otherwise the daily leaderboard tick would deactivate/stop them |
| D6 | Delete other pools only after DB backup | Destructive data action; rollback must be possible |
| D7 | Keep legacy open copy orders of removed traders | Avoid forced PnL/NAV changes; they close naturally via manage loop |
| D8 | Watchdog stale threshold raised for a quiet 5-wallet set | 5 low-activity wallets must not trigger resubscribe every 2 min |

## 5. Non-goals

- No on-chain program/vault work; `feat/program-vault` stays local-only.
- No UI redesign of pools/leaderboard.
- No change to fee math, HWM, deposit/withdraw, or settlement.
- No hard delete of wallets with history.
- No retention reduction below 120 days.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Wrong pool deleted | Explicit keep-list `(14,15)`, pre-delete backup, row-count audit |
| Live set empty after boot | Fallback to DB-active wallets + warning log |
| Rotation deactivates a pool trader | Pin live set active before deactivation loop; roster re-sync |
| 5 quiet wallets trigger WS churn | Watchdog stale threshold 30 min + scope reconcile 60 s |
| Stats stale for non-pool leaderboard wallets | Accepted: only pool traders are live; rotation still refreshes FomoScan PnL/ranks |
| Deploy restarts under load | Deploy order: backup → cleanup → code push → verify |

## 7. Acceptance evidence

- `GET /api/vaults/pools` returns exactly 2 pools (`14` partner, `15` basket)
  with identical 5-wallet baskets and equal weights.
- Backend log `[SolanaStream] live scope: 5 wallet(s), subs=5`.
- `[SyncScheduler] ... wallets=5`, stats updates ≤ 5.
- After ≥30 min: `realtime_events` per hour drops by >95% vs 14,685 baseline;
  load stable; no lock storms.
- All assert suites green, BE/FE typecheck + builds green, env contract green.
- Public URL + tailnet smoke 200; auth-gated routes 401.
