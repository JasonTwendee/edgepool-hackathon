# Three-Week Work Plan — Edgepool Solana Vault

The full work record: smart contract → backend → frontend → mainnet-ready — all inside 3 weeks. 15 working days × 4–5 work items per day = 70 items, written for progress reporting (standup/Jira). Each item is a work entry: a title plus one or two sentences describing the expected outcome.

**Weighting:** Week 1 (contract) carries 4 items/day; Weeks 2–3 carry 5 items/day so the entire scope — contract included — fits the 3-week window.

## Where we are today

**Week 1 (Days 1–5) — the smart contract build-out — is complete and verified.** The vault program is deployed and running on Solana devnet, passing all 26 tests, with a real deposit → withdraw lifecycle executed end to end: 0.6 SOL deposited and the withdrawal paid the exact hand-calculated amount. Weeks 2–3 below are the remaining work.

## The three weeks at a glance

| Week | Focus | Outcome | Items |
|---|---|---|---|
| Week 1 ✅ | Smart contract build-out & devnet launch | Program deployed & verified on devnet; full lifecycle executed | 20 |
| Week 2 | Backend integration & wallet foundation | The vault runs itself: values update automatically, database matches the chain 1-to-1; first wallet-signed deposit from the web | 25 |
| Week 3 | User flows, end-to-end demo & mainnet path | Withdraw + demo run end to end; Jupiter trading path code-complete (gated off); audit-ready package; final report | 25 |

Working-day schedule (example: starting Wednesday, Oct 14, 2026 — shift to fit your calendar):

| Day | Date | Day | Date | Day | Date |
|---|---|---|---|---|---|
| D1 | Wed Oct 14 | D6 | Wed Oct 21 | D11 | Wed Oct 28 |
| D2 | Thu Oct 15 | D7 | Thu Oct 22 | D12 | Thu Oct 29 |
| D3 | Fri Oct 16 | D8 | Fri Oct 23 | D13 | Fri Oct 30 |
| D4 | Mon Oct 19 | D9 | Mon Oct 26 | D14 | Mon Nov 02 |
| D5 | Tue Oct 20 | D10 | Tue Oct 27 | D15 | Tue Nov 03 |

---

# WEEK 1 — Smart contract build-out & devnet launch ✅ (completed)

Weekly goal: the vault program exists, is fully tested, and runs on devnet.

## Day 1 (D1) — Development environment & project setup

Today we stand up the toolchain and the project skeleton.

1. **T1.1 — Set up the Solana toolchain.** Install the Agave CLI (compiler toolchain + test validator) and the Anchor framework on the development machine, and verify a basic build runs.
2. **T1.2 — Scaffold the program workspace.** Create the project structure: workspace configuration, program crate, build scripts, and the program keypair — with a secure backup, since losing it means losing upgrade rights.
3. **T1.3 — First clean build + interface spec.** Get a green build producing the program binary and the interface specification (IDL), committed to the repository.
4. **T1.4 — Test harness groundwork.** Set up the fast in-process test environment and load the standard token programs the tests depend on.

End-of-day outcome: the build pipeline runs end to end.

## Day 2 (D2) — Core vault state & pricing math

Today we define what a vault stores and how its numbers are computed.

1. **T2.1 — Vault account state.** Implement the on-chain vault record: manager and keeper roles, share supply, high-water mark, position value, accrued fees, and policy parameters — sized down to the byte.
2. **T2.2 — Net asset value & share price.** NAV = cash + position value − accrued fees; price per share = NAV / total shares — 128-bit safe arithmetic, covered by unit tests.
3. **T2.3 — Deposit pricing.** Bootstrap pricing for the first deposit (1:1) and NAV-based pricing afterwards — minting math with floor rounding in favor of the fund, verified with exact-number tests.
4. **T2.4 — Performance fee math.** A 20% fee on new profits above the high-water mark, with ratchet behavior — unit-tested against a hand-worked example (the 0.08 SOL fee case).

End-of-day outcome: all pricing math is implemented and unit-tested.

## Day 3 (D3) — Core operations

Today we implement the four operations users and the keeper interact with.

1. **T3.1 — initialize_vault.** Create the four program addresses (vault record, share mint, fund custody account, signing authority) and fund the custody buffer.
2. **T3.2 — deposit.** Apply the minimum-size gate and the stale-data gate, settle fees first, then mint shares at the locked price — covered by unit and integration tests.
3. **T3.3 — withdraw with protection.** Burn shares, pay at the current price, enforce a minimum-payout threshold, check cash and the reserve floor — and keep the rule that withdrawals are never blocked.
4. **T3.4 — update_marks (keeper).** Position-value push with a 20%-per-update delta cap and a policy cap versus cash — restricted to the keeper role.

End-of-day outcome: deposits, withdrawals, and value updates all work in the test environment.

## Day 4 (D4) — Fee life cycle & operational controls

Today we complete the fee flow and the admin controls.

1. **T4.1 — settle_epoch & collect_fees.** Periodic fee settlement into accrued credit; fee payout bounded by accrued credit and available cash.
2. **T4.2 — set_paused & update_policy.** Admin controls: an emergency pause (blocks deposits and trading, never withdrawals) and parameter updates with bounds checking.
3. **T4.3 — record_sim_trade.** A devnet-only audit record for simulated trades — rejected on mainnet environments.
4. **T4.4 — Error codes & compact events.** A full error catalog and on-chain events for every operation, sized for the indexer.

End-of-day outcome: the fee life cycle and admin controls are complete.

## Day 5 (D5) — Test suites, devnet launch & end-to-end

Today we prove everything and put the program on devnet.

1. **T5.1 — Integration test suite (happy paths).** Full lifecycle on the in-process validator: initialize → deposit → marks → settle → withdraw, with exact balance assertions.
2. **T5.2 — Negative test suite.** Every guard proven: pause, stale data, caps, insufficient cash, reserve floor, role violations, and payout-below-minimum.
3. **T5.3 — Deploy to devnet.** Fund and deploy the program; record the program address, data size, and upgrade authority; verify through the explorer.
4. **T5.4 — Real end-to-end run.** Run the full lifecycle on real devnet with hand-calculated numbers verified (0.6 SOL deposit → withdrawal pays exactly the computed amount), and archive the evidence links.

End-of-day outcome: the program is live on devnet with a verified end-to-end run. **Week 1 complete: 26/26 tests, deployed program, real lifecycle executed.**

---

# WEEK 2 — Backend integration & wallet foundation

Weekly goal: the backend talks to the contract — values update automatically and database numbers match the chain — and the first wallet-signed deposit happens from the web.

## Day 6 (D6) — Backend: data foundation & contract client

Today we prepare storage and stand up the connection layer.

1. **T6.1 — Approval & chain configuration.** Get approval for the config/env updates and add the chain-related variables (program address, operator wallet, RPC, feature flags defaulting to off).
2. **T6.2 — Extend the database and apply the migration.** Add chain-link columns to the vault/deposit/withdrawal/epoch tables, create the event table with a uniqueness constraint (replays never duplicate), and apply the new migration on the local database.
3. **T6.3 — Create the chain module.** Add the backend module, wire it into the app, and read the configuration — with the feature flag off the system behaves exactly as before.
4. **T6.4 — Contract client layer.** Implement the Anchor-based client: read vault state, derive PDA addresses, and load the operator (keeper) wallet from configuration — secrets never logged.
5. **T6.5 — Commit and log progress.** Commit the day's work to the working branch (local only) and update the progress tracker.

End-of-day outcome: the database and the client layer are ready; nothing existing is affected.

## Day 7 (D7) — Backend: events & first sync

Today a real transaction on devnet becomes a database record.

1. **T7.1 — Contract event parser & tests.** Parse contract logs into structured events (all 8 types: deposit, withdraw, marks, epoch, fees, pause...), covered by sample-log fixtures in the test sweep.
2. **T7.2 — Real-time event listener.** When a new transaction lands on devnet, the parsed event is stored in the event table — verified live with a real deposit transaction.
3. **T7.3 — Record deposits as settled rows.** A deposit event becomes a settled deposit row with the transaction signature, shares minted, and price — values taken as integers from the event, never recomputed.
4. **T7.4 — Record withdrawals, epochs, and pause state.** Withdraw events become settled rows; epoch events become snapshots; pause events update the vault's displayed status.
5. **T7.5 — Backfill & heal loop.** If the backend restarts, it scans back from a cursor and fills the gap on a 60-second heal loop.

End-of-day outcome: the sample vault's real history is fully reproduced in the database.

## Day 8 (D8) — Backend: automation, faucet & reconciliation

Today the vault starts running itself and gets its operations tooling.

1. **T8.1 — Sync test suite.** Assert suite for the sync layer: sample logs → correct mapping, replay safety, settled values correct, heal path works.
2. **T8.2 — Compute asset value and push it on schedule.** Compute total position value from existing data (read-only, no changes to the protected copy-trade module), then push it to devnet every 30–60 seconds — only when it changed, with retries and signature logging; verified with three live ticks plus a unit test.
3. **T8.3 — Epoch settlement & simulated-trade records.** Settle performance fees on schedule and record new simulated trades to the contract (a cursor prevents duplicates).
4. **T8.4 — Emergency pause bridge.** When the risk monitor reports a halt, call the on-chain pause automatically; resume when recovered — only on state changes.
5. **T8.5 — Devnet SOL faucet.** API for users to request devnet SOL (devnet-only, daily limit, genesis check so it can never run against mainnet).

End-of-day outcome: the devnet vault updates its value on schedule (verifiable on the explorer); pause flips from the backend; the faucet works.

## Day 9 (D9) — Web: wallet connection foundation

Today the web app learns to talk to the contract through the user's wallet.

1. **T9.1 — Add libraries and contract spec.** Add the two required libraries (Anchor client + web3) matching backend versions, and copy the interface specification (IDL) into the web app.
2. **T9.2 — Base connection layer.** Create the devnet connection layer: initialize the program, derive account addresses, and read vault state.
3. **T9.3 — Transaction senders.** Functions to build deposit and withdraw transactions (including the minimum-payout guard), send them via the browser wallet, wait for confirmation, and handle timeouts.
4. **T9.4 — Error mapping.** Map every contract error code to a plain-language message ("Vault is paused", "Not enough shares to withdraw"...), and add chain types to the web app.
5. **T9.5 — Deposit dialog with signing states.** The user enters an amount (0.5 SOL minimum), sees a preview of shares at the current price, signs with their wallet — with every state visible (waiting, cancelled, failed, confirming) so the screen never hangs.

End-of-day outcome: the web reads vault data and the deposit flow is wired end to end.

## Day 10 (D10) — First real deposit, reconciliation & Week 2 close

Today we prove the loop from the browser and close the backend work.

1. **T10.1 — On-chain pool identity and helpers.** Label on-chain pools with an "ON-CHAIN · DEVNET" badge, add explorer links, and a "Get devnet SOL" button when the balance is low.
2. **T10.2 — First real deposit from the UI.** Execute a real deposit from the browser and archive the evidence: screenshots, transaction signature, and before/after numbers.
3. **T10.3 — Reconciliation tool & tests.** A scheduled job cross-checking five things between the database and the chain (total shares, every transaction by signature, fund cash flow, NAV, missing events), with fixture-based tests including a simulated mismatch that must raise the alert.
4. **T10.4 — Surface on-chain data on the pool page.** The pool detail page gains a chain block (contract address, price, asset value, pause state...) and the API documentation is updated.
5. **T10.5 — Full check, review, close Week 2.** Run the whole test suite, sync the technical docs, run the review process, and commit.

Week 2 outcome: the backend is complete and the first wallet-signed deposit from the web succeeded.

---

# WEEK 3 — User flows, end-to-end demo & mainnet path

Weekly goal: complete the withdrawal flow and demo, then deliver the Jupiter mainnet trading path (code-complete, gated off) plus the audit-ready package and final report.

## Day 11 (D11) — Withdraw flow & demo preparation

Today we complete the withdrawal experience and start the demo.

1. **T11.1 — Withdraw dialog: threshold, receipt, and errors.** The user enters shares, sees the estimated payout with a minimum-payout threshold (0.5% below the estimate), and gets a full receipt after the transaction (signature, shares burned, price, SOL received) — with plain-language errors for edge cases.
2. **T11.2 — Portfolio chain display.** The portfolio page lists on-chain pool investments with numbers from the synced API.
3. **T11.3 — Withdraw evidence (2 cases).** Run the success case and the blocked-by-threshold case, keeping screenshots and signatures.
4. **T11.4 — Write the demo script.** Step-by-step: mainnet signal → simulated position → auto value update → deposit → withdraw, with talking points.
5. **T11.5 — Jupiter technical spike.** Stand up a mock Jupiter program in the test environment as the foundation for the swap tests.

End-of-day outcome: withdrawals work from the web; the demo script is written; the swap test harness runs.

## Day 12 (D12) — Demo end-to-end & Week 3 checkpoint

Today we make the demo repeatable and close the UI work.

1. **T12.1 — Fix the demo bugs and prove repeatability.** Run the demo once, fix everything that breaks, then run the whole demo again from scratch — it must run repeatedly without manual fixes.
2. **T12.2 — Package the demo evidence.** Save the screenshot set (deposit, withdraw, NAV, blocked case) and explorer links.
3. **T12.3 — Full backend + frontend check.** Typecheck both sides, build the frontend, run smoke tests — nothing regresses.
4. **T12.4 — Docs sync, review, commit.** Update technical documentation, run the review process, and commit.
5. **T12.5 — First mock swap test.** Write a sample test calling through the mock program and note the account-mapping approach for the swap work.

End-of-day outcome: a complete demo that runs cleanly twice; the UI scope is closed.

## Day 13 (D13) — Jupiter swap inside the contract

Today we build the mainnet trading function.

1. **T13.1 — SOL ↔ WSOL conversion.** Implement wrapping SOL into WSOL and unwrapping it back after a trade, using the contract's own signing mechanism.
2. **T13.2 — Call Jupiter from the contract.** Implement the contract calling the Jupiter program to swap, taking the account list and route data prepared by the backend.
3. **T13.3 — Safety gates, output verification & clean build.** Mainnet-only when enabled, never while paused, per-trade size capped as a share of the fund, minimum-output check after the swap, trade event emitted — then rebuild, update the interface spec, and self-review against the design checklist.
4. **T13.4 — Finish the mock program.** The mock returns tokens at a fixed rate and can simulate failure cases.
5. **T13.5 — Buy & sell tests.** SOL in → tokens out in the right amount; tokens in → SOL out, with fund balance accurate to the smallest unit.

End-of-day outcome: the swap feature is code-complete; buy/sell tests pass against the mock.

## Day 14 (D14) — Swap hardening, dry-run tool & runbook

Today we close out the swap tests and prepare mainnet operations.

1. **T14.1 — Blocked-case tests.** Output below threshold (must revert), trade size over cap, fund paused, wrong role, wrong environment.
2. **T14.2 — Full test suite run.** Re-run all tests (existing + new), fix anything broken, update totals.
3. **T14.3 — Transaction dry-run tool.** Fetch a real Jupiter quote, build the complete transaction raw for inspection — never sent. Prints size and account count.
4. **T14.4 — Oversized route handling.** Detect routes exceeding the transaction size limit, log clearly, propose route splitting; never hang.
5. **T14.5 — Mainnet runbook, dry-run runs & review.** Write the pre-launch checklist (audit, multisig, limits, anti-frontrunning, monitoring, small-amount trial, incident procedure), run the dry-run twice (small and large routes), and send the runbook for review.

End-of-day outcome: all swap tests pass; the dry-run tool and runbook are ready.

## Day 15 (D15) — Hardening, audit package & final report

Today we run the strictest checks and package everything.

1. **T15.1 — Randomized & invariant testing.** Thousands of random scenarios (deposits, minting, fees...) with the core rules verified across any sequence: prices never negative, rounding favors the fund, total shares always match.
2. **T15.2 — Risk file.** Complete the risk reference — what is protected, what remains limited (the three known limitations) — ready for auditors.
3. **T15.3 — Cost report.** Measure account rent and transaction fees for each operation on devnet, with sample transactions.
4. **T15.4 — Multisig checklist & audit package.** Document the governance-move steps (documentation only) and assemble the audit submission one-pager (scope, design principles, known limitations, attached artifacts).
5. **T15.5 — Final report, demo & branch freeze.** Summary report (work done, evidence, risks, open questions), final demo run, and confirm the working branch stays local.

Week 3 outcome: withdraw + demo complete; Jupiter trading path code-complete (gated off); audit-ready package and final report delivered.

---

## Risks to watch

| Risk | Impact | Mitigation |
|---|---|---|
| Config approval is slow (Day 6) | Week 2 may slip | New config defaults to off — code first, approval only needed to enable |
| Devnet instability | Days 8 and 12 slow down | Wallets already hold SOL; the plan does not depend on the faucet |
| Oversized Jupiter routes | Day 14 technical limit | Detect + log + propose route splitting; does not block the week |
| External audit not booked | Outside the plan | Recommended to book in parallel, starting Week 2 |

## Explicitly NOT part of this plan

So the report cannot be misread, the following are out of scope:

- Real mainnet deployment and real funding (after audit — a separate decision).
- Executing the external audit (this plan only prepares the submission package).
- Actually setting up the multisig (this plan only writes the checklist).
- Advanced features such as withdrawal queues and on-chain ladder logic (reserved for v2).
