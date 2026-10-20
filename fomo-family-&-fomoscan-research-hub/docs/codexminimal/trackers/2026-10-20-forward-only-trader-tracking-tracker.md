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
| G1 | Removed trader open positions: natural close vs forced close | **Natural close** (manage to TP/stop/time) | 2026-10-20 | defaults approved |
| G2 | Fee attribution: current roster at settle vs origin trade | **Current roster at settle** (documented) | 2026-10-20 | defaults approved |
| G3 | Retired raw retention days | **30 days** (+ until last open order closes) | 2026-10-20 | defaults approved |
| G4 | Master performance display | **Fomo-only** (local fallback if Fomo unavailable) | 2026-10-20 | defaults approved |
| G5 | Enable `LIVE_ROSTER_MODE=top` | **After P8 dry-run**; currently `pin` | 2026-10-20 | pending rollout |
| G6 | Fomo “why top” fields available | Capture all returned rank/PnL/window fields; raw payload kept | 2026-10-20 | implementation |

> P4/P5 must not ship until G1/G2 are confirmed. Do not silently change money
> behavior.

## Phase status

| Phase | Status | Scope | Evidence |
|---|---|---|---|
| P0 | done | Decisions + Fomo field inventory + baseline | G1–G4 defaults; G5 pin until P8; baseline recorded |
| P1 | done | Migration: `enteredAt`/`exitedAt`/`entrySnapshot` | migration `20261020000003_vault_trader_forward_only`; Prisma client regen; BE typecheck |
| P2 | done | Fomo selection snapshot + fail-safe rotation | `selection-snapshot.ts`; fail-safe <5/outage; 30/30 asserts |
| P3 | done | Forward-only sync + master display source | `findLiveMemberships` + `sinceSec`; Fomo PnL path + local fallback |
| P4 | done | Auto-fire `blockTime` + entry watermark | query clock; `skippedBeforeEntry`; historical BUY test |
| P5 | done | Roster diff + immediate reconcile + open positions | enteredAt/exitedAt/snapshot; `reconcileLiveStream`; natural close |
| P6 | done | Retired data retention | `RETIRED_TRADER_RETENTION_DAYS=30`; archive+audit; open-order guard |
| P7 | done | API/UI source labels | pool trader `trackedSince`/`whyTop`; PnL `source=fomo|local`; chart fallback |
| P8 | in progress | Tests, dry-run, rollout, rollback | 30/30 asserts + builds; deploy + top dry-run pending |

## P0 checklist

- [x] Confirm G1 (natural vs forced close)
- [x] Confirm G2 (fee attribution)
- [x] Confirm G3 (retired retention 7/30/120)
- [x] Confirm G4 (Fomo-only vs hybrid display)
- [x] Confirm G5 (enable top after P8)
- [x] Inventory Fomo payload fields for “why top”
- [x] Snapshot current 5 memberships + open orders
- [x] Define deterministic selection criteria (rank windows + available metrics)

## P1 checklist — schema

- [x] Add `enteredAt`, `exitedAt`, `entrySnapshot`, `exitReason` to `VaultTrader`
- [x] New additive migration `20261020000003_vault_trader_forward_only`
- [x] Backfill active rows `entered_at=now()`
- [x] Backfill inactive rows `exited_at=now(), exit_reason='legacy'`
- [x] Regen Prisma client
- [x] BE typecheck/build
- [x] Update `docs/ai/entity-index.md`

## P2 checklist — Fomo snapshot

- [x] `buildSelectionSnapshot` pure helper + hash
- [x] Fetch leaderboard + per-candidate PnL (bounded)
- [x] Fail-safe: <5 verified or Fomo error → keep old roster
- [x] Persist `entrySnapshot` on activation
- [x] Audit `pool.roster_sync` with snapshot hash
- [x] Asserts: snapshot, fail-safe, deterministic order

## P3 checklist — forward-only

- [x] `findLiveMemberships()` with `enteredAt`
- [x] `HistorySyncService` `sinceSec` cutoff
- [x] `SyncService` passes membership cutoff
- [x] `OnchainService` pre-entry guard
- [x] Master PnL overview uses Fomo (G4)
- [x] No 120d backfill for new entrant
- [x] Asserts: cutoff, membership fallback

## P4 checklist — auto-fire

- [x] Query by `blockTime` (not `createdAt`)
- [x] `AUTO_FIRE_SIGNAL_CLOCK` default `blockTime`
- [x] Per-trader `enteredAt` gate
- [x] Skip exited/inactive traders
- [x] SELL without local position ignored
- [x] Asserts: historical BUY → 0; new BUY → 1; exited → 0
- [x] `.env.example` updated

## P5 checklist — rotation/manage

- [x] New member `enteredAt=now`, clear `exitedAt`
- [x] Kept member preserves `enteredAt`
- [x] Removed member `exitedAt=now`, `exitReason='rotation'`
- [x] Immediate `WalletsService.reconcileLiveStream()`
- [x] Optional first sync for new entrant (entry latency)
- [x] Old open orders remain managed (or G1 forced close)
- [x] Audit diff + snapshot hash
- [x] Asserts: re-entry resets term; no delete; reconcile called

## P6 checklist — retention

- [x] `RETIRED_TRADER_RETENTION_DAYS=30` (G3)
- [x] `ENTRY_LOOKBACK_MS=300000`
- [x] Daily batched cleanup for exited traders
- [x] Skip wallets with open copy orders
- [x] Archive + audit before delete
- [x] Never touch `copy_orders`/`copy_order_legs`/`partner_payouts`/`audit_logs`
- [x] Asserts: grace, open-order guard, fail-safe
- [x] Optional: trim legacy pre-entry tx/events of current 5 after G4 (Fomo-only display)

## P7 checklist — API/UI

- [x] Pool/trader payload: `enteredAt`, `trackedSince`, `selectionSnapshot`
- [x] “Why top” uses Fomo + snapshot time
- [x] “Pool performance” uses copy orders/NAV
- [x] No mixed PnL labels
- [x] Only 5 active displayed
- [x] openapi + FE types updated
- [x] FE typecheck/build

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
- 2026-10-20 P1–P7 implemented (defaults G1–G4):
  - migration `20261020000003_vault_trader_forward_only` (additive; current
    active rows `entered_at=now`, inactive `exited_at=now/legacy`);
  - Fomo selection snapshots (rank/PnL windows/trades/win-rate/raw + hash);
  - `findLiveMemberships` + `HistorySyncService sinceSec` (max 5m buffer);
  - auto-fire now queries `blockTime` and skips `< enteredAt`
    (`skippedBeforeEntry`), with `AUTO_FIRE_SIGNAL_CLOCK` legacy escape;
  - rotation sets `enteredAt/exitedAt/entrySnapshot`, calls immediate
    `reconcileLiveStream`;
  - Fomo primary PnL (`FOMOSCAN_PNL_PRIMARY=true`) with local fallback, and
    `source` label in API/UI;
  - retired prune after 30d, archive+audit fail-safe, open-order guard;
  - new asserts: selection snapshot, retired prune; auto-fire old-BUY cases.
- Verification so far: **30/30 assert suites green**, BE typecheck+build,
  FE typecheck, env contract 59+2. Deploy + top dry-run pending.

## Next action

1. Confirm G1–G4 (money/exit/retention/display).
2. Inventory Fomo payload fields.
3. Start P1 migration (additive only).
