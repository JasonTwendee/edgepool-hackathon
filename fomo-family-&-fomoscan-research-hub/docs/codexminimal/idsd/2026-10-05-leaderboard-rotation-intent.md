# Intent — Leaderboard rotation (auto top traders, cap 50)

- Date: 2026-10-05
- Stage: intent-bounded → execution (user: top Solana via FomoScan, drop manual
  add/remove, default top 20, DB cap 50, keep history)
- Parent: fomoscan P0–P2 + fund spec (copy scope).

## 1. Intent contract

- **Source**: `GET /v2/pump/leaderboard/traders?period=&limit=` (FomoScan snapshots
  every 30s; weekly default; daily/weekly/monthly). Consumer refresh: **daily**
  (rankings move slowly; 1 call/day ≈ zero quota).
- **Rotation** (`sync`, ADMIN tick + daily loop default ON):
  - Top N (env `LEADERBOARD_TOP_N=20`) → tracked ACTIVE (create if missing with
    label/handle from leaderboard + best-effort enrich; reactivate if dormant).
  - Active tracked NOT in top N → `isActive=false` (**history + orders kept**).
  - Cap: total rows > `LEADERBOARD_CAP=50` → delete oldest INACTIVE (cascade tx,
    documented; active never pruned).
- **Cash-out rule (user-confirmed)**: NO forced exit on drop. No NEW entries
  (dropped wallets stop syncing → no fresh signals; auto-fire already requires
  active vaultTraders). Open positions keep managed to natural close
  (TP/stop/time via manage tick).
- **Remove manual add/remove**: DELETE `POST /api/wallets` + `DELETE :address`
  routes, FE Add/Remove UI, lib `addWallet/removeWallet`. PATCH copy-config stays.
  `WalletsService.create/remove` removed (rotation owns writes).
- **Non-goals**: EVM tracking, per-vault auto-assign from leaderboard, thesis ingestion.
- **Acceptance**: rotation dry-run correct; live top20 active; dropped kept w/ history;
  cap enforced; tsc + asserts GREEN; live tick on server.

## 2. Decisions

- D-R1 daily auto ON (08:00 UTC? no — interval-based, default 24h) + manual tick.
- D-R2 prune oldest-inactive only past 50 (never active, never orders-only rows… orders
  reference wallets only by address string — cascade safe).
- D-R3 period env `LEADERBOARD_PERIOD=weekly` (daily|weekly|monthly).
