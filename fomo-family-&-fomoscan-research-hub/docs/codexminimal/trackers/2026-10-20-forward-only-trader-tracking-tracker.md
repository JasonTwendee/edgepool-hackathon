# Tracker — Forward-Only Trader Tracking + FomoScan Selection Snapshots

Topic: `forward-only-trader-tracking`
Intent: `docs/codexminimal/idsd/2026-10-20-forward-only-trader-tracking-intent.md`
Plan: `docs/codexminimal/plans/2026-10-20-forward-only-trader-tracking-phase-plan.md`
Status: **planned** — no code changes yet.

## Current baseline (2026-10-20)

| Item | Value |
|---|---|
| Public pools | 2 (`14` partner 75/25, `15` basket 50/50) |
| Shared roster | 5 wallets × 2000bps |
| Display surface | `/api/wallets` = 5; PnL overview = 5; rotation active=5 |
| Live pipeline | WS/sync/stats = 5 |
| DB | 66 MB (after raw-data trim) |
| Rotation mode | `LIVE_ROSTER_MODE=pin` (no daily top change yet) |
| Master data | 5 active wallets; ~48k tx / ~14k events since 2026-10-05 |
| Asserts | 28/28 green |

## Decision log (GATE)

| # | Question | Decision | Date | Owner |
|---|---|---|---|---|
| G1 | Removed trader open positions: natural close vs forced close | **PENDING** (default: natural close) | — | owner |
| G2 | Fee attribution: current roster at settle vs origin trade | **PENDING** (default: current roster at settle) | — | owner |
| G3 | Retired raw retention days | **PENDING** (default: 30) | — | owner |
| G4 | Master performance display | **PENDING** (default: Fomo-only) | — | owner |
| G5 | Enable `LIVE_ROSTER_MODE=top` | **PENDING** (keep `pin` until P8) | — | owner |
| G6 | Fomo “why top” fields available | **PENDING inventory** | — | implementation |

> P4/P5 must not ship until G1/G2 are confirmed. Do not silently change money
> behavior.

## Phase status

| Phase | Status | Scope | Evidence |
|---|---|---|---|
| P0 | in progress | Decisions + Fomo field inventory + baseline | baseline above; G1–G6 open |
| P1 | pending | Migration: `enteredAt`/`exitedAt`/`entrySnapshot` | — |
| P2 | pending | Fomo selection snapshot + fail-safe rotation | — |
| P3 | pending | Forward-only sync + master display source | — |
| P4 | pending | Auto-fire `blockTime` + entry watermark | — |
| P5 | pending | Roster diff + immediate reconcile + open positions | — |
| P6 | pending | Retired data retention | — |
| P7 | pending | API/UI source labels | — |
| P8 | pending | Tests, dry-run, rollout, rollback | — |

## P0 checklist

- [ ] Confirm G1 (natural vs forced close)
- [ ] Confirm G2 (fee attribution)
- [ ] Confirm G3 (retired retention 7/30/120)
- [ ] Confirm G4 (Fomo-only vs hybrid display)
- [ ] Confirm G5 (enable top after P8)
- [ ] Inventory Fomo payload fields for “why top”
- [ ] Snapshot current 5 memberships + open orders
- [ ] Define deterministic selection criteria (rank windows + available metrics)

## P1 checklist — schema

- [ ] Add `enteredAt`, `exitedAt`, `entrySnapshot`, `exitReason` to `VaultTrader`
- [ ] New additive migration `20261020000003_vault_trader_forward_only`
- [ ] Backfill active rows `entered_at=now()`
- [ ] Backfill inactive rows `exited_at=now(), exit_reason='legacy'`
- [ ] Regen Prisma client
- [ ] BE typecheck/build
- [ ] Update `docs/ai/entity-index.md`

## P2 checklist — Fomo snapshot

- [ ] `buildSelectionSnapshot` pure helper + hash
- [ ] Fetch leaderboard + per-candidate PnL (bounded)
- [ ] Fail-safe: <5 verified or Fomo error → keep old roster
- [ ] Persist `entrySnapshot` on activation
- [ ] Audit `pool.roster_sync` with snapshot hash
- [ ] Asserts: snapshot, fail-safe, deterministic order

## P3 checklist — forward-only

- [ ] `findLiveMemberships()` with `enteredAt`
- [ ] `HistorySyncService` `sinceSec` cutoff
- [ ] `SyncService` passes membership cutoff
- [ ] `OnchainService` pre-entry guard
- [ ] Master PnL overview uses Fomo (G4)
- [ ] No 120d backfill for new entrant
- [ ] Asserts: cutoff, membership fallback

## P4 checklist — auto-fire

- [ ] Query by `blockTime` (not `createdAt`)
- [ ] `AUTO_FIRE_SIGNAL_CLOCK` default `blockTime`
- [ ] Per-trader `enteredAt` gate
- [ ] Skip exited/inactive traders
- [ ] SELL without local position ignored
- [ ] Asserts: historical BUY → 0; new BUY → 1; exited → 0
- [ ] `.env.example` updated

## P5 checklist — rotation/manage

- [ ] New member `enteredAt=now`, clear `exitedAt`
- [ ] Kept member preserves `enteredAt`
- [ ] Removed member `exitedAt=now`, `exitReason='rotation'`
- [ ] Immediate `WalletsService.reconcileLiveStream()`
- [ ] Optional first sync for new entrant (entry latency)
- [ ] Old open orders remain managed (or G1 forced close)
- [ ] Audit diff + snapshot hash
- [ ] Asserts: re-entry resets term; no delete; reconcile called

## P6 checklist — retention

- [ ] `RETIRED_TRADER_RETENTION_DAYS=30` (G3)
- [ ] `ENTRY_LOOKBACK_MS=300000`
- [ ] Daily batched cleanup for exited traders
- [ ] Skip wallets with open copy orders
- [ ] Archive + audit before delete
- [ ] Never touch `copy_orders`/`copy_order_legs`/`partner_payouts`/`audit_logs`
- [ ] Asserts: grace, open-order guard, fail-safe
- [ ] Optional: trim legacy pre-entry tx/events of current 5 after G4 (Fomo-only display)

## P7 checklist — API/UI

- [ ] Pool/trader payload: `enteredAt`, `trackedSince`, `selectionSnapshot`
- [ ] “Why top” uses Fomo + snapshot time
- [ ] “Pool performance” uses copy orders/NAV
- [ ] No mixed PnL labels
- [ ] Only 5 active displayed
- [ ] openapi + FE types updated
- [ ] FE typecheck/build

## P8 checklist — rollout

- [ ] All asserts + BE/FE typecheck/build + env contract
- [ ] Staging dry-run with a new top candidate
- [ ] Verify zero historical copy
- [ ] Verify old open orders still manage
- [ ] Verify new entrant data starts at `enteredAt`
- [ ] Manual `top` tick in maintenance window
- [ ] Enable 24h rotation
- [ ] Monitor 2 cycles
- [ ] Rollback plan tested (`pin`)

## Test matrix

| Case | Expected |
|---|---|
| New entrant has 120d BUY history, all backfilled with `createdAt=now` | 0 copy orders |
| New BUY with `blockTime >= enteredAt` | 1 copy order |
| Same BUY duplicated | 1 copy order (dedupe) |
| Old trader BUY after `exitedAt` | 0 copy orders |
| Old trader open order after exit | Still reaches TP/stop/time |
| Fomo leaderboard 503 | Roster unchanged + audit |
| Fomo returns 4 verified wallets | Roster unchanged |
| New entrant re-enters after exit | New `enteredAt`; old term preserved |
| Retired wallet cleanup | Raw tx/events gone; orders/ledger intact |
| Wallet retired but has open order | Raw data kept until order closes + grace |

## Data policy

| Data | Active roster | Retired roster |
|---|---|---|
| `transactions` | from `enteredAt`; 120d cap | keep 30d grace or until open order closes |
| `realtime_events` | from `enteredAt`; active feed | can delete after exit + short grace |
| `copy_orders` / legs | keep | keep forever (history) |
| `vault_traders` | current membership | keep inactive row + timestamps |
| `partner_payouts` | keep | keep |
| `audit_logs` | keep | keep |
| Fomo snapshot | keep in `entrySnapshot` + audit hash | keep |

## Risks

| Risk | Status | Mitigation |
|---|---|---|
| Historical BUY copied as fresh | **high until P4** | `blockTime` + `enteredAt` + test |
| Fomo outage causes bad rotation | medium | Fail-safe keep roster + audit |
| Fee attribution unfair on exit | **open G2** | Settle at epoch boundary or per-origin |
| Open positions on exit | **open G1** | Natural close default |
| DB grows with daily churn | medium | retired 30d + no new backfill |
| Entry signal missed in WS gap | medium | immediate reconcile + 5m safety buffer |
| Re-entry confusion | low | new term + `trackedSince` UI |

## Handoff log

- 2026-10-20: user approved forward-only direction. Intent + phase plan +
  tracker created. No code changes. Awaiting G1/G2/G3/G4 confirmations and Fomo
  field inventory before P1.
- Baseline: 2 pools / 5 shared traders / DB 66 MB / 28-28 asserts / rotation
  `pin`.

## Next action

1. Confirm G1–G4 (money/exit/retention/display).
2. Inventory Fomo payload fields.
3. Start P1 migration (additive only).
