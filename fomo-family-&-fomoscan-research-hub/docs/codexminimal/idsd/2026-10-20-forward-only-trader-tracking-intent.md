# Intent — Forward-Only Trader Tracking + FomoScan Selection Snapshots

- Date: 2026-10-20
- Topic: `forward-only-trader-tracking`
- Status: planned (awaiting policy decisions)
- Supersedes for future work: the 120-day backfill behavior for newly selected
  traders; the current `LIVE_ROSTER_MODE=pin` is intentionally unchanged until
  this plan ships.

## 1. Decision

Use **FomoScan as the selection + explainability source**:

- top/rank/PnL windows, trades, win-rate-style metrics, and whatever payload
  explains why a wallet made the top;
- store an immutable selection snapshot at rotation time.

Use **local data only from the moment a trader enters our pool/vault**:

- WS + safety-net sync from `enteredAt`;
- copy signals only from `enteredAt`;
- pool PnL/NAV from local copy orders;
- no 120-day historical transaction backfill for a new entrant.

> FomoScan decides **who** and **why**.  
> Local decides **when** and **what we copy**.

## 2. Problem

Today the live pipeline backfills up to 120 days for every new live wallet.
That creates three problems:

1. **Stale-signal risk:** after backfill, `auto-fire` can see old BUYs as fresh
   because it filters by `createdAt` (DB insert time), not `blockTime`.
2. **DB bloat:** each new top trader creates tens of thousands of raw rows even
   though we never intend to copy their history.
3. **Wrong product semantics:** copy-trading should start at entry, not mirror
   historical positions at today's price.

FomoScan already provides aggregate performance/rank data, but not per-trade
signatures, token mints, amounts, or venue. It cannot replace the local
execution ledger; it replaces the need to rebuild each trader's full history.

## 3. Scope

In scope:

- membership timestamps for every pool trader (`enteredAt`/`exitedAt`);
- immutable Fomo selection snapshot per rotation;
- forward-only sync from `enteredAt` (small gap buffer only);
- auto-fire clock fix (`blockTime`) + entry watermark;
- 24h `top` rotation with fail-safe;
- retirement/retention policy for raw data;
- UI labels separating Fomo “why top” from local pool performance;
- tests for new entrant, old trader, and stale backfill.

Out of scope:

- mirroring a trader's existing holdings at entry;
- forced liquidation policy (decision gate);
- a full FomoScan replacement or redistribution of its data;
- on-chain program/vault changes (`feat/program-vault` stays local-only);
- deleting money ledger/order/audit data.

## 4. Target data model

Add to `VaultTrader` (current membership):

| Field | Purpose |
|---|---|
| `enteredAt` | start of this membership; auto-fire lower bound |
| `exitedAt` | when the trader left the roster |
| `entrySnapshot` (JSONB) | raw Fomo metrics/rank/payload at selection |
| `exitReason` | `rotation`, `manual`, `risk`, … |

`TrackedWallet` keeps Fomo display fields (`fomoPnlUsd`, `fomoRank`,
`rank24h/7d/30d`). Local `cumulativePnlUsd` is no longer the primary “trader
performance” display.

If re-entry history becomes a product requirement, add an append-only
`vault_trader_terms` table later; the current plan preserves old rows and audit
logs, not a full term ledger.

## 5. Rotation flow (24h)

1. Fetch Fomo top candidates + per-candidate metrics.
2. Validate ≥5 verified Solana wallets; otherwise keep the old roster and audit
   `rotation.fomo_unavailable`.
3. Persist selection snapshot (raw payload + hash + `fetchedAt`).
4. Diff roster:
   - new → `enteredAt=now`, `exitedAt=null`, `entrySnapshot=…`;
   - removed → `exitedAt=now`, `exitReason='rotation'`, `isActive=false`.
5. Reconcile live scope **immediately** (do not wait for the 60s loop):
   - WS subscribe new; unsubscribe old;
   - listener registry updated;
   - `SyncService` starts from `enteredAt`.
6. No historical copy. Old open positions stay under `manage` until natural
   close (default; policy gate).
7. Audit `pool.roster_sync` with addresses + snapshot hash.

If Fomo fails, the old roster continues; no partial/degraded selection.

## 6. Copy rules

- `auto-fire` filters by **`blockTime`**, never `createdAt`.
- A signal is eligible only if
  `blockTime >= enteredAt(vault, trader)`.
- Backfilled rows (if any for display) are never eligible.
- SELL signals for tokens with no copied position are ignored.
- Dedupe by `masterTxHash` remains.
- Entry gap: fetch a small buffer (`enteredAt - 5m`) for safety, but persist/copy
  only `blockTime >= enteredAt`.

## 7. Data retention

- Current 5: keep what exists (120d cap for active roster).
- New entrants: store only rows from `enteredAt`; no 120d backfill.
- Exited traders:
  - keep raw tx/events for `RETIRED_TRADER_RETENTION_DAYS` (default 30) or until
    their last open copy order closes, whichever is later;
  - then delete raw tx/events, keep `copy_orders`, snapshots, payouts, audit;
  - if they re-enter later, start a **new term** and fetch from the new entry,
    not from old history.
- `realtime_events` for retired traders can be deleted sooner than
  `transactions` because the feed no longer shows them.

## 8. Fee / open-position policy (decision gate)

Two unresolved choices:

1. **Removed trader open positions:** natural close (recommended, current rule)
   or forced close at rotation mark.
2. **Fee attribution:** current active roster at settlement (simple) or origin
   trader/order (accurate but requires per-order attribution).

If no decision is made, ship with natural close + current-roster-at-settlement,
and state it explicitly in the UI/docs. Do not silently change money behavior.

## 9. Acceptance criteria

- New entrant with 120 days of historical BUYs: **zero** copy orders from those
  rows.
- A BUY with `blockTime >= enteredAt`: copied exactly once.
- Old trader after exit: no new copy orders; open orders still reach TP/stop/time.
- Fomo selection snapshot persisted; a failed Fomo fetch keeps the old roster.
- No 120-day backfill for a new entrant; DB growth proportional to new signals.
- Retired raw data cleanup never touches money ledger/orders/audit.
- UI shows “why top” (Fomo) and “pool performance since entry” (local) with
  separate labels.
- All existing assert suites + new forward-only asserts green.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Fomo metrics change/delay/outage | Snapshot raw payload + hash; keep old roster on failure |
| Historical BUY accidentally copied | `blockTime` + `enteredAt` filter + regression test |
| Signal missed during roster switch | Immediate WS reconcile + safety-net from `enteredAt - 5m` |
| Old open positions / fee unfairness | Policy gate; natural close default; settle at epoch boundary |
| DB grows again with churn | Retired 30d retention + no new-entrant backfill |
| Fomo “why top” is not enough | Store all returned fields; add selection criteria (win rate, trades, consistency) |
| Re-entry confusion | New term resets `enteredAt`; UI shows “tracked since” |

## 11. Open questions

1. Natural close vs forced close for removed traders?
2. Fee by current roster at settlement vs origin trade?
3. Retired raw retention: 7 / 30 / 120 days?
4. Master performance display: Fomo-only, or Fomo + local “since entry” hybrid?
5. Does Fomo return win-rate/consistency fields, or only PnL/trades/volume?
6. Should we pre-warm the next top candidates (e.g., top 10) before rotation?
