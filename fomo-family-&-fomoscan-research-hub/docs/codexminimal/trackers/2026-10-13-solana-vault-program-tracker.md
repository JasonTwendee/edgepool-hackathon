# Tracker — Solana Vault Program (`edgepool_vault`)

Topic: solana-vault-program | Branch: **`feat/program-vault`** (không merge main) | Intent: `docs/codexminimal/idsd/2026-10-13-solana-vault-program-intent.md` | Plan: `docs/codexminimal/plans/2026-10-13-solana-vault-program-phase-plan.md` | Design: `docs/architecture/SOLANA_PROGRAM_DESIGN.md` v1.1

## Status

- [ ] P0 toolchain + Anchor workspace + build xanh
- [ ] P1 program core ix 1–9 + Rust/LiteSVM tests + deploy devnet + e2e
- [ ] P2 BE chain module: migration, indexer, keeper, faucet, reconcile + asserts
- [ ] P3 FE chain client + user-signed deposit/withdraw + demo e2e
- [ ] P4 Jupiter `execute_swap` + mock-CPI + dry-run + runbook (flag OFF)
- [ ] P5 fuzz + threat model + cost report + multisig/audit checklist

## Handoff log

- 2026-10-13: intent + system design v1.1 approved; branch `feat/program-vault` created từ main@948eadf; design docs committed (`5ca56d3`). Plan written. Bắt đầu P0.

## Review verdict

(chưa — verdict per phase; reviewer: rust-code-reviewer P1/P4, nestjs-code-reviewer P2)

## Divergences / notes

- Rule branch: user yêu cầu 2026-10-13 — không merge vào main; mọi commit chỉ trên `feat/program-vault`.
- Patch v1.1 (min_payout, max_marks_bps, reconcile 3 tầng) là phần của baseline P1/P2, không phải scope mới.

## Test gaps

- (chưa có — cập nhật theo phase)

## Next phase

P0 — cài Agave CLI + scaffold Anchor workspace + `anchor build` xanh.
