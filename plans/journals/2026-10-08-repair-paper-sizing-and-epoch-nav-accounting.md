---
title: Repair paper sizing and epoch NAV accounting
date: 2026-10-08
summary: "Corrected copy allocation and SOL NAV; verified epochs, partial exits and concurrent settlement on isolated Postgres."
---

# Repair paper sizing and epoch NAV accounting

## What happened
Source inspection and new regression tests proved source-wallet size was incorrectly used for copy caps/storage, and USD PnL was added to SOL NAV. Epoch accounting also repeated unrealized PnL and omitted gross withdrawal outflows.

## Changes and evidence
Actual allocation now drives quotes, stored orders and exposure gates. A nullable PnL epoch baseline prevents double-counting; partial-leg exposure and realized PnL are shared across NAV/ledger. Settlement valuation runs under the Postgres lock; a real-DB test exposed the old lock query's void result incompatibility with Prisma. Loss gates use share-price returns to exclude cash flows.

Backend typecheck/build, 26 assert suites and isolated Postgres concurrency/rollback/accounting checks passed. Migration was applied only to a task-owned local database. Existing YAML parsing failure was confirmed against HEAD and corrected by quoting its description.

## Next steps
Before deploying, migrate and review any legacy pool with pre-existing confirmed trades before explicitly establishing its NAV baseline. Paper accounting remains separate from future on-chain custody/execution. No mainnet money was moved.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
