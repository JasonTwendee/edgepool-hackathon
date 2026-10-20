# Phase Plan — Forward-Only Trader Tracking + FomoScan Selection Snapshots

- Topic: `forward-only-trader-tracking`
- Intent: `docs/codexminimal/idsd/2026-10-20-forward-only-trader-tracking-intent.md`
- Tracker: `docs/codexminimal/trackers/2026-10-20-forward-only-trader-tracking-tracker.md`
- Status: planned — decisions marked **GATE** must be confirmed before execution.
- Workflow: repo-phase-orchestrator → native execution → evidence per phase.

## Overview

Replace “backfill 120d then copy” with:

1. **FomoScan selects and explains** the top 5 (snapshot at rotation).
2. **Local tracks only from `enteredAt`** (WS + safety net, no historical copy).
3. **Auto-fire uses on-chain `blockTime` + entry watermark**.
4. **Old open positions** are managed to natural close (default; GATE).
5. **Retired data** is trimmed after a grace period, not kept for 120d forever.

Success = a new entrant's 120 days of historical BUYs produce **zero** copy
orders, while a BUY after `enteredAt` is copied exactly once.

## Approvals / protected paths

- `backend/prisma/migrations/*`: **new additive migration only**; never edit an
  applied migration (Prisma checksum drift).
- `backend/src/modules/copy-trade/**`: sensitive execution logic — explicit
  owner approval required before P4/P5 edits.
- `.env`: commit only `.env.example`; server values are applied via
  `scripts/sync-env.sh`, never logged in docs.
- Docs must contain no personal data, IPs, tailnet names, machine names, or
  local absolute paths.
- Keep `LIVE_ROSTER_MODE=pin` until P8 rollout; this plan itself changes no
  production behavior.

## Decision gates (P0)

| # | Decision | Default if unconfirmed | Impact |
|---|---|---|---|
| G1 | Removed trader open positions: natural close or forced close | Natural close | Money/NAV behavior |
| G2 | Fee attribution: current roster at settle or origin trader | Current roster at settle | Partner payouts fairness |
| G3 | Retired raw retention: 7 / 30 / 120 days | 30 days | DB growth/re-entry |
| G4 | Master performance display: Fomo-only or Fomo + local since-entry | Fomo-only | UI/API semantics |
| G5 | Enable `LIVE_ROSTER_MODE=top` after rollout | Keep `pin` until P8 | Production behavior |
| G6 | Fomo fields available for “why top” (win rate/consistency) | Use whatever payload returns | Selection criteria/UI |

Do not start P4/P5 until G1+G2 are confirmed; they touch money behavior.

## Phase map

| Phase | Goal | Touches money? | Deploy? |
|---|---|---|---|
| P0 | Decisions, baseline, Fomo payload inventory | No | No |
| P1 | Membership timestamps + entry snapshot schema | Additive only | No |
| P2 | Fomo selection snapshot + fail-safe rotation | No | No |
| P3 | Forward-only sync/live scope + stop master FIFO display | Read paths | No |
| P4 | Auto-fire `blockTime` + `enteredAt` watermark | **Yes** (copy gate) | No |
| P5 | Rotation/roster diff + immediate reconcile + open-position policy | **Yes** | No |
| P6 | Retired data retention/cleanup | Raw data only | No |
| P7 | API/UI labels: Fomo “why top” vs pool “since entry” | No | No |
| P8 | Tests, dry-run, rollout, rollback | No | Yes |

## P0 — Baseline & decisions

### Steps
1. Record current state: 2 pools, shared 5 roster, 66 MB DB, active=5,
   `LIVE_ROSTER_MODE=pin`, 28/28 asserts.
2. Inventory the exact Fomo response fields used for selection:
   - leaderboard entry: rank, pnl, username, verified;
   - `/v2/user/handle/:handle/pnl`: windows, netUsd, returnPct, volumeUsd,
     trades, buys, sells, tokensTraded, winningTokens, rank, status.
3. Confirm G1–G6 with the owner. Record choices in tracker.
4. Snapshot the current 5 `vault_traders` rows and current open orders.
5. Define “why top” criteria: rank windows first; use win rate/trades/tokens
   only when Fomo returns them. No invented metrics.

### Verification
- Decision table in tracker filled.
- Fomo field inventory documented with example shape (no secrets).
- Baseline recorded.

### Stop condition
G1/G2 unresolved → stop before P4/P5.

## P1 — Schema + migration

### Files/modules
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20261020000003_vault_trader_forward_only/migration.sql`
- `backend/src/generated/prisma/**` (regen)
- `docs/ai/entity-index.md`

### Steps
1. Add to `VaultTrader`:
   - `enteredAt DateTime? @map("entered_at") @db.Timestamptz()`
   - `exitedAt DateTime? @map("exited_at") @db.Timestamptz()`
   - `entrySnapshot Json? @map("entry_snapshot") @db.JsonB`
   - `exitReason String? @map("exit_reason") @db.VarChar(32)`
2. Add `@@index([vaultId, enteredAt])` if useful for live queries.
3. Migration (additive only):
   - add columns nullable;
   - backfill active rows: `entered_at = now()`;
   - backfill inactive rows: `exited_at = now()`, `exit_reason='legacy'`;
   - no data deletion.
4. Regen Prisma client; typecheck.
5. Update `docs/ai/entity-index.md`.

### Verification
```
npm --prefix backend run typecheck
npm --prefix backend run build
```
Migration applies cleanly on staging; no rewrite of applied migrations.

### Acceptance
- Current 5 have `enteredAt` set; auto-fire can use it.
- Old inactive traders have `exitedAt`; no behavior change while `pin`.

## P2 — Fomo selection snapshot + fail-safe

### Files/modules
- `backend/src/modules/leaderboard/leaderboard.service.ts`
- `backend/src/common/fomoscan/fomoscan.service.ts` (types if needed)
- `backend/src/modules/leaderboard/assert-leaderboard.ts`
- `backend/src/modules/audit/audit.service.ts` usage

### Steps
1. Extract a pure `buildSelectionSnapshot(boardEntry, pnl, fetchedAt)` helper:
   - rank24h/7d/30d, netUsd/returnPct/volume/trades/buys/sells/tokens/winning,
   - `source:'fomoscan'`, `fetchedAt`, raw payload subset, sha256 hash.
2. In rotation (`LIVE_ROSTER_MODE=top`):
   - fetch leaderboard + `getPnl` for the candidate set (bounded to top N);
   - validate ≥5 verified Solana wallets;
   - if Fomo fetch/validation fails → **no roster change**, audit
     `rotation.fomo_unavailable`, keep old roster;
   - persist snapshot per selected trader (`entrySnapshot` on activation).
3. Audit `pool.roster_sync` with addresses, snapshot hash, period, `fetchedAt`.
4. Ensure `pin` mode still works and does not fetch extra Fomo data.
5. Add asserts:
   - snapshot persisted;
   - Fomo failure keeps roster unchanged;
   - <5 verified keeps roster;
   - deterministic selection order.

### Verification
```
npx tsx src/modules/leaderboard/assert-leaderboard.ts
npm --prefix backend run typecheck
```

### Acceptance
- Every new roster member has an immutable “why top” snapshot.
- A Fomo outage can never produce an empty/partial roster.

## P3 — Forward-only sync + master display source

### Files/modules
- `backend/src/modules/sync/history-sync.service.ts`
- `backend/src/modules/sync/sync.service.ts`
- `backend/src/modules/wallets/wallets.service.ts`
- `backend/src/modules/portfolio/pnl.service.ts`
- `backend/src/modules/onchain/onchain.service.ts`
- `backend/src/modules/leaderboard/leaderboard.service.ts` (membership query)

### Steps
1. Add `findLiveMemberships(): Promise<{wallet: TrackedWallet; enteredAt: Date}[]>`
   to WalletsService (join `vault_traders` + `tracked_wallets`; pinned/live rules).
2. `HistorySyncService.syncWallet` accepts `sinceSec?: number`:
   - `cutoff = max(now - days*86400, sinceSec - ENTRY_LOOKBACK_MS/1000)`;
   - deep/incremental logic still works, but stops at cutoff;
   - no 120d deep backfill for a new entrant.
3. `SyncService` passes membership `enteredAt`; logs `since=...`.
4. `OnchainService`:
   - ignore persistence/emit for events with `blockTime < enteredAt` if the
     event belongs to a new term (defense in depth; auto-fire is the real gate).
5. Master performance display:
   - stop `syncWalletStats` from overwriting the 5 displayed wallets' primary
     PnL with local FIFO (G4);
   - `GET /api/portfolio/pnl/overview` uses Fomo fields/windows for the 5;
   - keep local FIFO only for explicit admin/copy-ledger diagnostics (if kept).
6. `realtime_events`/`transactions` only from entry for new entrants.
7. Add asserts for cutoff (`sinceSec`) and membership query fallback.

### Verification
```
npx tsx src/modules/sync/assert-sync.ts
npx tsx src/modules/sync/assert-rpc-parse.ts
npm --prefix backend run typecheck
```

### Acceptance
- New entrant fetches only from `enteredAt - 5m`; no 120d rows.
- Master overview uses Fomo data; pool PnL still uses local orders.
- No new rows older than `enteredAt` for a new term.

## P4 — Auto-fire blockTime + watermark (GATE G1/G2)

### Files/modules
- `backend/src/modules/copy-trade/auto-fire.service.ts`
- `backend/src/modules/copy-trade/assert-autofire.ts`
- `backend/src/modules/copy-trade/manage.service.ts` (read-only verification)
- `backend/.env.example`

### Steps
1. Change signal query from `createdAt` to `blockTime`:
   - `sinceSec = floor((now - window)/1000)`;
   - `blockTime: { gte: BigInt(sinceSec) }`.
2. Add `AUTO_FIRE_SIGNAL_CLOCK=blockTime|createdAt` (default `blockTime`) for
   legacy demo seeding only; production must use `blockTime`.
3. In the per-signal loop:
   - find active `vault_traders` for the bot/vault;
   - require `enteredAt` and
     `blockTime >= floor(enteredAt.getTime()/1000)`;
   - skip otherwise (`skippedBeforeEntry` counter).
4. Never copy a signal if the trader is inactive/exited.
5. Ignore SELL signals for tokens with no local copied position (if the signal
   path is enabled).
6. Add asserts:
   - old BUY backfilled with `createdAt=now`, `blockTime<enteredAt` → 0 orders;
   - BUY with `blockTime>=enteredAt` → 1 order;
   - exited trader BUY → 0 orders;
   - dedupe remains.
7. Update `.env.example` with `AUTO_FIRE_SIGNAL_CLOCK`.

### Verification
```
npx tsx src/modules/copy-trade/assert-autofire.ts
npx tsx src/modules/copy-trade/assert-manage.ts
npm --prefix backend run typecheck
```

### Acceptance
- Historical backfill can never create a copy order.
- New signal after entry is copied once.
- Old open orders still managed (no active-wallet filter in manage).

## P5 — Rotation diff + immediate reconcile + open positions

### Files/modules
- `backend/src/modules/leaderboard/leaderboard.service.ts`
- `backend/src/modules/leaderboard/leaderboard.module.ts`
- `backend/src/modules/wallets/wallets.service.ts`
- `backend/src/modules/copy-trade/manage.service.ts` (verification only)

### Steps
1. `syncPublicPoolRosters`:
   - new member: upsert `isActive=true`, `enteredAt=now`, `exitedAt=null`,
     `entrySnapshot`, `exitReason=null`;
   - existing member: keep `enteredAt`, update weight only;
   - removed: `isActive=false`, `exitedAt=now`, `exitReason='rotation'`;
   - never hard-delete old terms.
2. After roster commit, call `WalletsService.reconcileLiveStream()` immediately
   (inject WalletsModule into LeaderboardModule; avoid circular imports).
3. Optional: trigger a first forward sync for the new entrant immediately instead
   of waiting for the 120s safe-net tick. If not, document max entry latency and
   rely on WS + next tick.
4. Open positions:
   - natural close (default): `manage` continues; no forced sell;
   - if G1=forced close: add an explicit exit at rotation mark, separate phase
     with money assert; do not mix into this phase.
5. Audit roster diff (`added/removed/kept`) + snapshot hash.
6. Asserts:
   - kept member keeps original `enteredAt`;
   - new member gets new `enteredAt` even if they had an old row;
   - removed member gets `exitedAt`, no delete;
   - reconcile is called (spy);
   - old open orders remain manageable.

### Verification
```
npx tsx src/modules/leaderboard/assert-leaderboard.ts
npm --prefix backend run typecheck
```

### Acceptance
- Roster switch is atomic in DB; live scope follows within one reconcile.
- Re-entry starts a new term, not the old timestamp.
- No old order is deleted/forced-closed unless G1 explicitly says so.

## P6 — Retired data retention

### Files/modules
- `backend/src/modules/sync/sync.service.ts` (cleanup job)
- `backend/src/modules/leaderboard/leaderboard.service.ts` (exit timestamps)
- `backend/.env.example`
- `backend/src/modules/sync/assert-sync.ts`

### Steps
1. Add `RETIRED_TRADER_RETENTION_DAYS=30` (G3) and
   `ENTRY_LOOKBACK_MS=300000`.
2. Cleanup job (daily, batched):
   - find `vault_traders` with `isActive=false`, `exitedAt < cutoff`;
   - skip if the wallet has an open `copy_order` (`closedAt=null`);
   - archive then delete `transactions`/`realtime_events` for those wallets;
   - keep `tracked_wallets`, `vault_traders`, `copy_orders`, `copy_order_legs`,
     `partner_payouts`, `audit_logs`;
   - audit counts + cutoff.
3. Do not apply the retired cutoff to active roster data; active keeps the
   existing 120d policy.
4. Add asserts:
   - retired wallet old rows deleted after grace;
   - wallet with open order preserved;
   - money ledger/orders/audit untouched;
   - archive/audit failure → zero deletes (reuse prune fail-safe pattern).
5. Update docs with the two retention windows (active 120d, retired 30d).
6. Optional after G4 confirms Fomo-only display: archive/delete the current 5's
   **pre-entry** tx/events (legacy backfill older than their `enteredAt`). Keep
   copy orders/epochs/audit. This is a one-time DB clean-up, not an automatic
   rotation action. Record before/after counts.

### Verification
```
npx tsx src/modules/sync/assert-sync.ts
npm --prefix backend run typecheck
```

### Acceptance
- DB growth bounded by active roster + grace window.
- Retired data cleanup cannot touch money/orders/audit.
- Re-entry after cleanup fetches from the new `enteredAt` only.

## P7 — API/UI labels

### Files/modules
- `backend/src/modules/vaults/vault.service.ts` (`pools()` / pool detail)
- `backend/src/modules/wallets/wallets.controller.ts` / service DTO
- `frontend/types/fund.ts`, `frontend/types/onchain.ts`
- `frontend/components/VaultCard.tsx`, trader profile/terminal components
- `docs/api/openapi.yaml` if response fields change

### Steps
1. Add to pool/trader payloads:
   - `enteredAt`, `exitedAt`, `trackedSince`;
   - `selectionSnapshot` (rank/PnL/window/trades) for “why top”;
   - source labels: `fomo` vs `pool-copy`.
2. UI:
   - “Why top” block uses Fomo metrics + snapshot time;
   - “Pool performance” uses copy orders/NAV, not Fomo master PnL;
   - old trader history remains in order history; active basket only 5.
3. Ensure only 5 live wallets are returned/displayed; no 100-row leak.
4. Update openapi + FE types.
5. FE typecheck + build.

### Acceptance
- No mixed PnL: user can tell Fomo trader stats from pool copy performance.
- New entrant shows “tracked since” date.
- Only 5 active displayed.

## P8 — Tests, dry-run, rollout

### Steps
1. Run all assert suites + BE/FE typecheck + builds + env contract + openapi.
2. Staging dry run:
   - set `LIVE_ROSTER_MODE=top`, `LEADERBOARD_SYNC_INTERVAL_MS=0`;
   - manual tick with a candidate set that includes a new wallet;
   - verify snapshot, membership timestamps, WS swap, no historical copy;
   - verify old open orders still managed;
   - verify database rows only from entry for the new wallet.
3. Production rollout:
   - deploy with `LIVE_ROSTER_MODE=pin` (no behavior change);
   - run one manual `top` tick in a maintenance window;
   - inspect diff + first signals;
   - enable 24h interval;
   - monitor 2 cycles.
4. Monitor:
   - historical-copy count must stay 0;
   - new-entry signal latency;
   - DB growth/day;
   - Fomo failure/fallback logs;
   - fee/settlement behavior.
5. Rollback:
   - set `LIVE_ROSTER_MODE=pin`;
   - keep membership data;
   - no data deletion required;
   - audit rollback.

### Acceptance
- 29+ assert suites green (new suite included).
- Zero historical copy orders in dry run.
- Rotation is fail-safe when Fomo is down.
- Rollback to `pin` is one env change.

## Files summary

- Schema/migration: `backend/prisma/schema.prisma`, new migration.
- Selection: `leaderboard.service.ts`, `fomoscan.service.ts`.
- Membership/live scope: `wallets.service.ts`, `sync.service.ts`,
  `history-sync.service.ts`, `onchain.service.ts`.
- Copy gate: `auto-fire.service.ts`, `assert-autofire.ts`.
- Retention: `sync.service.ts`, `assert-sync.ts`.
- UI/API: `vault.service.ts`, wallets DTOs, `frontend/types/*`,
  `frontend/components/*`, `openapi.yaml`.
- Docs: this plan, intent, tracker, `docs/ai/*`.

## Risks / stop conditions

- Stop if G1/G2 not confirmed before P4/P5.
- Stop if Fomo payload does not contain enough “why top” fields; fall back to
  rank/PnL windows only, do not invent metrics.
- Stop if a new entry produces any copy order from historical data.
- Stop if retired cleanup would touch open orders or money ledger.
- Stop if WS/reconcile latency makes first-signal copying unsafe; add immediate
  entry sync before enabling `top`.

## Rollback

1. `LIVE_ROSTER_MODE=pin`.
2. Keep schema columns/nullable data.
3. Leave current roster/orders untouched.
4. Re-enable only after the failing gate is fixed.
