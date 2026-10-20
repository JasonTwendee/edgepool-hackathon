# Phase Plan — Two-Pool Live Scope + Load Slimming

- Topic: `two-pool-live-scope-slimming`
- Intent: `docs/codexminimal/idsd/2026-10-20-two-pool-live-scope-slimming-intent.md`
- Tracker: `docs/codexminimal/trackers/2026-10-20-two-pool-live-scope-slimming-tracker.md`
- Approvals: 2026-10-20 (same 5 wallets, partner/basket fee rules, delete other
  pools, keep 120 days, apply load optimizations 1–5).
- Workflow: repo-phase-orchestrator → native execution → evidence per phase.

## Phase map

| Phase | Goal | Destructive | Deploy |
|---|---|---|---|
| P0 | Baseline, backup, roster snapshot | No (backup only) | No |
| P1 | Live-scope resolver + stream/wallet reconcile + rotation pin | No | No |
| P2 | Debounce + scoped stats + SSE buffer + watchdog tuning | No | No |
| P3 | Asserts + typecheck + builds | No | No |
| P4 | VPS data cleanup: keep 14/15, delete 1/16/17/35–38 | Yes | No |
| P5 | Push/deploy + live verification + 30/60-min metrics | No | Yes |
| P6 | Docs/indexes/logs + retrospective | No | No |

## P0 — Baseline & safety

### Steps
1. Record baseline: pools/traders/shares/NAV, 30 active wallets, 39 WS subs,
   14,685 events/h, DB sizes (done 2026-10-20).
2. On VPS (`edgepool-dev`), dump vault-related tables to
   `/home/ubuntu/backups/pre-two-pool-<UTC>.dump`:
   `vaults, vault_deposits, vault_withdrawals, vault_epochs, vault_traders,
   partner_payouts, copy_orders, copy_order_legs, trader_requests,
   signed_intents, bots, tracked_wallets`.
3. Verify dump file size + `pg_restore --list` count > 0.
4. Snapshot row counts for every table in the delete scope.

### Verification
- Backup exists on VPS with non-zero size; `pg_restore --list` succeeds.
- Baseline numbers stored in tracker.

### Stop condition
Backup fails → stop; do not proceed to P4.

## P1 — Live-scope resolver + stream/wallet reconcile

### Files
- `backend/src/common/live-scope.ts` (new)
- `backend/src/server/solana-stream.service.ts`
- `backend/src/modules/wallets/wallets.service.ts`
- `backend/src/modules/leaderboard/leaderboard.service.ts`
- `backend/src/modules/leaderboard/leaderboard.module.ts` (if DI needed)

### Steps
1. Add `LiveScope = { mode: 'pool' | 'all'; addresses: Set<string> }`.
   - `selectLiveScope(rows, mode)` pure: `all` → all mode; `pool` + non-empty →
     pool; empty → fallback all.
   - `resolveLiveScope(prisma)` queries distinct active `vault_traders` whose
     vault is `listing='public'` and `status='live'`.
2. `SolanaStreamService.resetTo(addresses)`: watch missing, unwatch extras,
   log `live scope: N wallet(s), subs=N`.
3. `WalletsService`:
   - `findAllLive()` returns rows from live scope (fallback active).
   - `reconcileLiveStream()` resolves scope, pins live rows `isActive=true`,
     updates listener registry + stream via `resetTo`, logs diff.
   - Boot: seed → reconcile. Interval `LIVE_SCOPE_RECONCILE_MS=60000`.
   - `onModuleDestroy` clears interval.
4. `LeaderboardService`:
   - Resolve scope at tick start.
   - Pin live wallets active before deactivation.
   - Skip deactivation/unwatch for live wallets.
   - Only live-wire top actives that are in scope.
   - Reconcile registry/stream against live scope, not all DB actives.
   - End of tick: `syncPublicPoolRosters()` enforces both public pools share the
     same ≤5 wallets, equal weights, `max_traders=5`.
   - Pure `pickRoster(rows, n)` helper for tests.

### Verification
- `npx tsx src/modules/leaderboard/assert-leaderboard.ts`
- New `assert-live-scope.ts` (P3)
- BE typecheck

### Acceptance
- In pool mode, rotation never subscribes/deactivates a non-pool wallet.
- Live roster drift between the two pools is corrected each tick.
- Empty roster falls back to active wallets with a warning.

## P2 — Debounce, scoped stats, SSE buffer, watchdog

### Files
- `backend/src/common/debounce.ts` (new)
- `backend/src/modules/onchain/onchain.service.ts`
- `backend/src/modules/onchain/onchain.controller.ts`
- `backend/src/modules/sync/sync.service.ts`
- `backend/src/modules/portfolio/pnl.service.ts`
- `backend/src/server/solana-stream.service.ts`
- `backend/.env.example`

### Steps
1. `Debouncer` utility: per-key timer, `schedule`, `flush`, `clear`,
   `pendingCount`; `0 ms` = immediate.
2. `OnchainService`: WS handler → debouncer (`LIVE_DEBOUNCE_MS=3000`); keep
   in-flight guard; clear timers on destroy. Webhook ingest stays direct.
3. `SyncService`: `wallets.findAllLive()`; pass the same set to stats;
   log `wallets=5`.
4. `PnlService.syncWalletStats(days, addresses?)`: filter wallets when provided.
5. SSE: buffer events per connection, flush every `SSE_FLUSH_MS=500`
   (max 200 buffered); heartbeat unchanged; cleanup on unsubscribe.
6. Watchdog: stale threshold `LIVE_WATCHDOG_STALE_MS=1800000` default.
7. `.env.example`: add the 5 new variables with defaults + comments.

### Acceptance
- WS burst for one wallet causes one pipeline attempt per 3 s window.
- Stats loop never computes non-live wallets.
- SSE emits buffered events at most every 500 ms; no memory growth on disconnect.

## P3 — Asserts + local verification

### Steps
1. New `backend/src/common/assert-live-scope.ts`:
   - `selectLiveScope` pool/all/empty-fallback.
   - `Debouncer` coalesces bursts and flushes.
   - SSE buffer drain/limit helper.
2. Extend `assert-leaderboard.ts`:
   - Pool mode pins live wallet even when outside topN.
   - Rotation does not watch non-pool top wallets.
   - Roster sync makes both pools identical (if fake supports vaults).
3. Run all assert suites (`find backend/src -name 'assert-*.ts'` runner order),
   BE typecheck, BE build, FE typecheck, FE build.
4. Run env contract script + OpenAPI parse.

### Acceptance
- 28/28 (or more) assert suites green.
- Typecheck/builds green; env contract green.

## P4 — VPS data cleanup

### Steps
1. Re-verify backup from P0.
2. Run one transaction:
   - `UPDATE vaults SET max_traders=5 WHERE id IN (14,15)`.
   - Deactivate old `vault_traders` for 14/15; upsert top 5 with `weight_bps=2000`.
   - `UPDATE tracked_wallets SET is_active=true WHERE address IN (top5)`.
   - Delete `copy_order_legs` via cascade after `copy_orders` for deleted vaults;
     delete `signed_intents` for deleted vaults; delete bots for deleted vaults.
   - `DELETE FROM vaults WHERE id NOT IN (14,15)` (cascades deposits,
     withdrawals, epochs, traders, payouts, trader requests).
3. Verify post-state:
   - vaults = 2; kinds = partner/basket; both baskets identical; 5 traders each.
   - deleted-scope row counts = 0; kept deposits/withdrawals/epochs unchanged.
4. Record counts in tracker.

### Acceptance
- Exactly two pools; same roster and weights.
- No orphan copy orders/signed intents/bots for deleted pools.
- Kept pool 14/15 share and NAV values unchanged.

## P5 — Deploy + live verification

### Steps
1. Commit + push `main` (auto-deploy via GitHub Actions + self-hosted runner).
2. Watch deploy logs; confirm Prisma migrations clean (no new migration).
3. Verify:
   - `GET /api/vaults/pools` = 2, same roster.
   - Backend logs: `live scope: 5`, `SyncScheduler ... wallets=5`.
   - WS subs = 5; watchdog not churning.
   - After 30–60 min: events/hour, load, DB growth, stats duration.
4. Smoke public URL, tailnet URL, FE routes, auth-gated 401.
5. If event rate does not drop or live scope wrong → rollback code only
   (data cleanup is independent; vaults already backed up).

### Acceptance
- Live subs = 5; event rate < 5% of baseline; load < 1.5 steady;
  no PG lock/CPU storms; public smoke green.

## P6 — Docs + close-out

### Steps
1. Update `docs/ai/refactor-log.md` (change, evidence, metrics).
2. Update `docs/ai/rule-registry.md` (durable live-scope/roster rules).
3. Update `docs/ai/route-index.md` only if routes changed (none expected).
4. Update `docs/codexminimal/{current-work,artifact-registry,telemetry}.json`.
5. Update project/context indexes for the new common files.
6. Tracker final verdict + residual risks.

### Acceptance
- Docs match code/data; tracker has all evidence and commit SHA.
