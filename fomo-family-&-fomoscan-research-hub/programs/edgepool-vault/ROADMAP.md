# Four-Week Work Plan — Edgepool Solana Vault

The full work record: smart contract → backend → frontend → mainnet-ready. 20 working days × 4 work items per day = 80 items, written for progress reporting (standup/Jira). Each item is a work entry: a title plus one or two sentences describing the expected outcome.

## Where we are today

**Week 1 (Days 1–5) — the smart contract build-out — is complete and verified.** The vault program is deployed and running on Solana devnet, passing all 26 tests, with a real deposit → withdraw lifecycle executed end to end: 0.6 SOL deposited and the withdrawal paid the exact hand-calculated amount. Weeks 2–4 below are the remaining work.

## The four weeks at a glance

| Week | Focus | Outcome | Items |
|---|---|---|---|
| Week 1 ✅ | Smart contract build-out | Program deployed & verified on devnet; full lifecycle executed | 20 |
| Week 2 | Backend connects to the contract | The vault runs itself: values update automatically, database matches the chain 1-to-1 | 20 |
| Week 3 | User interface + end-to-end demo | Users sign their own deposits/withdrawals from the web on devnet; the demo runs cleanly twice in a row | 20 |
| Week 4 | Mainnet trading path (Jupiter) + hardening + reporting | Trading path code-complete (gated off); audit-ready package; final report | 20 |

Working-day schedule (example: starting Wednesday, Oct 14, 2026 — shift to fit your calendar):

| Day | Date | Day | Date |
|---|---|---|---|
| D1 | Wed Oct 14 | D11 | Wed Oct 28 |
| D2 | Thu Oct 15 | D12 | Thu Oct 29 |
| D3 | Fri Oct 16 | D13 | Fri Oct 30 |
| D4 | Mon Oct 19 | D14 | Mon Nov 02 |
| D5 | Tue Oct 20 | D15 | Tue Nov 03 |
| D6 | Wed Oct 21 | D16 | Wed Nov 04 |
| D7 | Thu Oct 22 | D17 | Thu Nov 05 |
| D8 | Fri Oct 23 | D18 | Fri Nov 06 |
| D9 | Mon Oct 26 | D19 | Mon Nov 09 |
| D10 | Tue Oct 27 | D20 | Tue Nov 10 |

---

# WEEK 1 — Smart contract build-out ✅ (completed)

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

# WEEK 2 — Backend connects to the chain

Weekly goal: the backend can talk to the contract — asset values update automatically on a schedule, and every deposit/withdrawal in the database matches the chain exactly.

## Day 6 (D6) — Prepare the data foundation

Today we prepare storage for the on-chain vaults and add the configuration needed.

1. **T6.1 — Get approval and add chain configuration.** Request approval to update the config file and environment template with the chain-related variables (program address, operator wallet, RPC endpoint, etc.). Everything defaults to off so the running system stays unaffected.
2. **T6.2 — Extend the database for on-chain vaults.** Add chain-link columns to the vault/deposit/withdrawal/epoch tables and create a new table for all events emitted by the contract. The event table has a uniqueness constraint so replays never duplicate data.
3. **T6.3 — Create and apply the migration.** Write a new migration (never edit applied ones), apply it to the local Postgres, and regenerate the Prisma client. Confirm the backend typecheck passes.
4. **T6.4 — Commit and log progress.** Commit the day's work to the working branch (local only) and update the progress tracker.

End-of-day outcome: the database is ready for on-chain data and nothing existing is affected.

## Day 7 (D7) — Connect the backend to the contract

Today we create the backend module that reads from and listens to the contract.

1. **T7.1 — Create the chain module.** Add a new backend module, wire it into the app, and read the configuration from Day 6. With the feature flag off, the system behaves exactly as before.
2. **T7.2 — Build the contract client layer.** Implement the client using the standard library (Anchor) to read vault state, derive PDA addresses, and load the operator (keeper) wallet from configuration — secrets never logged.
3. **T7.3 — Contract event parser.** Parse contract logs into structured events, covering all 8 event types (deposit, withdraw, marks, epoch, fees, pause...). Covered by unit tests using sample logs.
4. **T7.4 — Real-time event listener.** When a new transaction lands on devnet, the parsed event is stored in the event table; replays never duplicate. Verified with a real deposit transaction.

End-of-day outcome: a deposit transaction on devnet shows up in the local database as a parsed event.

## Day 8 (D8) — Data sync and reconciliation

Today we finish the sync so every on-chain transaction becomes a business record, with a self-healing mechanism for missed events.

1. **T8.1 — Record deposits as settled business rows.** A deposit event becomes a settled deposit row with the transaction signature, shares minted, and the price at that moment — values taken as integers from the event, never recomputed, to avoid rounding drift.
2. **T8.2 — Record withdrawals, epochs, and pause state.** Withdraw events become settled withdrawal rows; epoch events become epoch snapshots; pause events update the vault's displayed status.
3. **T8.3 — Backfill for missed events.** If the backend is down or restarts, it scans back from a cursor and fills in the gap; runs on a 60-second heal loop.
4. **T8.4 — Tests for the sync layer.** Write an assert suite for the module: sample logs → correct mapping, replay safety, settled values correct, heal path works. Added to the project-wide test sweep.

End-of-day outcome: the data from the real sample vault is fully reproduced in the database; the new assert suite passes.

## Day 9 (D9) — Automatic value updates and the safety switch

Today the system starts driving itself: it pushes asset values to the contract on a schedule, settles fees, and flips the emergency pause when needed.

1. **T9.1 — Compute asset value (marks) from existing data.** Reuse the backend's existing position data to compute the total value; read-only, no changes to the protected copy-trade module. Covered by unit tests on the computation.
2. **T9.2 — Periodic value push loop.** Every 30–60 seconds push the new value to devnet; only send when the number changed (save fees); retry with backoff on network errors; log each transaction signature for lookup.
3. **T9.3 — Epoch settlement and simulated-trade records.** Settle performance fees on a schedule, and automatically record new simulated trades to the contract (a cursor prevents duplicates).
4. **T9.4 — Emergency pause bridge.** When the backend's risk monitor reports a halt condition, call the on-chain pause automatically; when conditions recover, resume. Only call on state changes to avoid extra transactions.

End-of-day outcome: the devnet vault updates its value on schedule — verifiable on the explorer; pause state flips from the backend.

## Day 10 (D10) — Finish the backend and close Week 2

Today we add the remaining utilities and package the backend work.

1. **T10.1 — Devnet SOL faucet for users.** Add an API for users to request devnet SOL (devnet-only, one request per day per user, with a genesis check so it can never run against mainnet).
2. **T10.2 — Automatic reconciliation tool.** A scheduled job that cross-checks five things between the database and the chain: total shares, every transaction by signature, fund cash flow in/out, NAV, and missing events to backfill. Any mismatch raises an alert immediately.
3. **T10.3 — Surface on-chain data on the pool page.** The pool detail page gains a chain block (contract address, price, asset value, pause state...) and the API documentation is updated.
4. **T10.4 — Full check, review, close the week.** Run the whole test suite, sync the technical docs, run the review process, and commit to close the week.

Week 2 outcome: the backend is complete — the vault runs itself on devnet, database numbers match the chain, and monitoring plus the user faucet are in place.

---

# WEEK 3 — User interface and end-to-end demo

Weekly goal: real users sign their own deposits/withdrawals from the web with their wallets on devnet, and a demo that runs cleanly more than once.

## Day 11 (D11) — Wallet connection layer in the web app

Today the web app learns to talk to the contract through the user's wallet.

1. **T11.1 — Add libraries and contract spec to the web app.** Add the two required libraries (Anchor client + web3) matching the backend versions, and copy the contract interface spec (IDL) into the web app.
2. **T11.2 — Build the base connection layer.** Create the devnet connection layer: initialize the program, derive account addresses (vault, mint, treasury...), and read vault state.
3. **T11.3 — Build the transaction senders.** Functions to build deposit and withdraw transactions (including the minimum-payout guard for withdrawals), send them via the browser wallet (Phantom/Solflare), wait for confirmation, and handle timeouts.
4. **T11.4 — Translate contract errors into clear messages.** Map every contract error code to a plain-language message ("Vault is paused", "Not enough shares to withdraw"...), and add chain types to the web app.

End-of-day outcome: the web app reads vault data from devnet; the transaction senders are ready to wire into the UI.

## Day 12 (D12) — Build the deposit flow

Today we complete the deposit experience in the UI.

1. **T12.1 — Deposit dialog for on-chain pools.** The user enters an amount (0.5 SOL minimum), sees a preview of shares to be received at the current price, taps deposit, and signs with their wallet. Numbers refresh after confirmation.
2. **T12.2 — Clear signing/sending/error states.** Show every state: waiting for wallet, user cancelled, transaction failed, confirming. The screen never "hangs" when the user cancels.
3. **T12.3 — On-chain pool identity and helpers.** Label on-chain pools with an "ON-CHAIN · DEVNET" badge, add explorer links, and a "Get devnet SOL" button when the balance is too low.
4. **T12.4 — Run it for real and save evidence.** Execute a real deposit from the browser and save screenshots, the transaction signature, and before/after numbers in the tracker.

End-of-day outcome: a real deposit from the web to devnet succeeds.

## Day 13 (D13) — Build the withdraw flow

Today we complete the withdrawal experience, including the protection for the user when prices move.

1. **T13.1 — Withdraw dialog with a protection threshold.** The user enters the number of shares to withdraw, sees the estimated SOL payout, and the system sets a minimum-payout threshold (0.5% below the estimate) to block surprise bad prices. A warning appears if the fund has open positions (withdrawal may be blocked by low cash).
2. **T13.2 — Receipt and friendly error messages.** After withdrawal, show a full receipt (transaction signature, shares burned, price, SOL received) with an explorer link. Errors like "below minimum payout" or "insufficient liquidity" display plain-language explanations with next steps.
3. **T13.3 — Show on-chain positions on the portfolio page.** The portfolio page lists on-chain pool investments, with numbers coming from the synced API.
4. **T13.4 — Test both scenarios and save evidence.** Run the success case and the blocked-by-threshold case (deliberately set a high threshold), keeping screenshots and transaction signatures.

End-of-day outcome: a real withdrawal from the web succeeds; the blocked case displays correctly and clearly.

## Day 14 (D14) — Build the end-to-end demo

Today we assemble the full story into one complete, repeatable demo.

1. **T14.1 — Write the demo script.** A step-by-step presentation script: a signal from a real trader wallet on mainnet → simulated position → the fund value updates automatically → a user deposits → the user withdraws. Include suggested talking points for each step.
2. **T14.2 — Fix bugs from the first dry run.** Run the demo once and fix everything that breaks, keeping a list of bugs and fixes.
3. **T14.3 — Run it a second time to prove repeatability.** Run the whole demo again from scratch — the goal is that it can run repeatedly without manual technical fixes.
4. **T14.4 — Package the demo evidence.** Save the screenshot set (deposit, withdraw, NAV, blocked case) and explorer links in the tracker.

End-of-day outcome: one complete demo that runs cleanly twice in a row, with a script and evidence.

## Day 15 (D15) — Close Week 3 and start the Jupiter prep

Today we package the UI work and lay the groundwork for the mainnet trading path.

1. **T15.1 — Full backend + frontend check.** Run typecheck on both sides, build the frontend, and run the smoke tests — nothing should regress.
2. **T15.2 — Sync docs, review, and commit.** Update the technical documentation, run the review process, and commit to close Week 3.
3. **T15.3 — Jupiter technical spike.** Stand up a mock Jupiter program in the test environment as the foundation for testing real swaps later.
4. **T15.4 — First mock swap test.** Write a sample test that calls through the mock program and note down the account-mapping approach for Day 16.

Week 3 outcome: users sign their own deposits/withdrawals from the web on devnet; the end-to-end demo is complete; the test foundation for Jupiter is in place.

---

# WEEK 4 — Mainnet trading via Jupiter + hardening + reporting

Weekly goal: the mainnet trading path is code-complete (gated off), security is hardened, and the audit package plus final report are ready.

## Day 16 (D16) — Build the swap function inside the contract

Today we build the week's most important piece: the contract executes buy/sell trades on mainnet through Jupiter.

1. **T16.1 — Handle SOL-to-token conversion.** Implement wrapping SOL into WSOL and unwrapping it back after the trade, using the contract's own signing mechanism.
2. **T16.2 — Call Jupiter from inside the contract.** Implement the contract calling the Jupiter program to swap, taking the account list and route data prepared by the backend.
3. **T16.3 — Safety gates and output verification.** Apply all safety conditions: mainnet-only when enabled, never while paused, per-trade size capped as a share of the fund, and verify the received amount meets the minimum threshold; emit a trade event.
4. **T16.4 — Build and self-review.** Rebuild the contract (updating the interface spec), self-review against the design checklist, and record it in the tracker.

End-of-day outcome: the swap feature is code-complete and builds cleanly.

## Day 17 (D17) — Test the swap with a mock program

Today we prove the swap works using a mock Jupiter program — no real funds involved.

1. **T17.1 — Finish the mock program.** The mock accepts the account list and returns tokens at a fixed rate; it can be configured to simulate failure cases.
2. **T17.2 — Buy and sell tests.** Buy test: SOL in → tokens out in the right amount; sell test: tokens in → SOL out, with the fund balance accurate to the smallest unit.
3. **T17.3 — Blocked-case tests.** Cases: output below threshold (must revert), trade size over the cap, fund paused, wrong role, wrong environment.
4. **T17.4 — Run the full test suite.** Re-run all existing tests plus the new ones, fix anything broken, and update the tracker with the new totals.

End-of-day outcome: all swap tests pass and the overall test count increases.

## Day 18 (D18) — Dry-run tool and mainnet runbook

Today we prepare the tool to inspect mainnet transactions before sending them, and write the operations runbook.

1. **T18.1 — Transaction dry-run tool.** The tool fetches a real Jupiter quote, builds the complete transaction in raw form for inspection — it never sends anything. It prints the transaction size and the number of accounts used.
2. **T18.2 — Handle oversized routes.** Some large swap routes exceed the transaction size limit — the tool detects this, logs it clearly, and proposes a follow-up approach instead of hanging the system.
3. **T18.3 — Write the mainnet runbook.** A complete pre-launch checklist: audit completed, governance moved to a multisig, limits reviewed, anti-frontrunning configured (Jito), monitoring in place, a small-amount trial run, and the incident procedure (pause everything).
4. **T18.4 — Run the tool and review the runbook.** Run the dry-run twice (small and large routes) and send the runbook for review.

End-of-day outcome: a working dry-run tool for real transactions plus an approved operations runbook.

## Day 19 (D19) — Security hardening

Today we run the strictest checks so the math can never go wrong, and measure real costs.

1. **T19.1 — Randomized testing of the math.** Run thousands of random scenarios (deposits, minting, fees...) to be sure there is no overflow or crash path.
2. **T19.2 — Invariant testing.** Confirm the core rules hold across any random sequence of operations: prices never go negative, rounding always favors the fund, total shares always match.
3. **T19.3 — Finalize the risk file.** Complete the risk reference — what is protected, what remains limited (the three known limitations) — ready to hand to auditors.
4. **T19.4 — Real cost report.** Measure account rent and transaction fees for each operation on devnet (initialize, deposit, withdraw, keeper cycle...) — numbers with a few sample transactions.

End-of-day outcome: the strict checks pass; the risk file and cost report are ready.

## Day 20 (D20) — Multisig, audit package, and final report

Today we package everything and present.

1. **T20.1 — Multisig checklist (Squads).** Document the steps to move contract governance to a multisig wallet — documentation only, not executed, to be run before mainnet.
2. **T20.2 — Audit submission package.** Assemble a one-pager: what will be reviewed (the functions), the design principles, the known limitations, and the attached artifacts (design doc, tests, contract spec).
3. **T20.3 — Four-week summary report.** Report in the team's format: work done, evidence (explorer/doc links), remaining risks, open questions.
4. **T20.4 — Final demo and branch freeze.** Run the final demo, confirm the working branch stays local (not pushed, per the standing rule), and record the freeze note.

Week 4 outcome: the mainnet trading path is code-complete (gated off), and the audit package plus final report are complete.

---

## Risks to watch

| Risk | Impact | Mitigation |
|---|---|---|
| Config approval is slow (Day 6) | Week 2 may slip | New config defaults to off — code first, approval only needed to enable |
| Devnet instability | Days 9 and 14 slow down | Wallets already hold SOL; the plan does not depend on the faucet |
| Oversized Jupiter routes | Day 18 technical limit | Detect + log + propose route splitting; does not block the week |
| External audit not booked | Outside the plan | Recommended to book in parallel, starting Week 2 |

## Explicitly NOT part of this plan

So the report cannot be misread, the following are out of scope:

- Real mainnet deployment and real funding (after audit — a separate decision).
- Executing the external audit (this plan only prepares the submission package).
- Actually setting up the multisig (this plan only writes the checklist).
- Advanced features such as withdrawal queues and on-chain ladder logic (reserved for v2).
