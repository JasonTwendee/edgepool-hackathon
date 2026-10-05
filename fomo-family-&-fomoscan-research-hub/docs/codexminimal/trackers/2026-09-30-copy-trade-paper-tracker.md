# Tracker — Copy-trade paper (devnet, 1-click, full DB+UI)

- Topic: copy-trade-paper
- Plan: `docs/codexminimal/plans/2026-09-30-copy-trade-paper-phase-plan.md`
- Intent: `docs/codexminimal/idsd/2026-09-30-copy-trade-paper-intent.md`
- Started: 2026-09-30
- Statuses: `open` → `in_progress` → `done` | `blocked`

## Phases (P5 = E2E CLOSED 2026-10-02)

- P5 E2E: `done` — vault funded 5 devnet SOL → order #4 CONFIRMED,
  sig `5RYRk…8RJTraN8A5` verified finalized/err-null slot 506512658 ✅,
  history returns it ✅. Explorer:
  https://explorer.solana.com/tx/5RYRkDVNBCNntQEUDwHYgqqHyPFTqybvhF3jgtbrYyXWtRh5YCR5ywxDK3nsoyUPVoaM5ASyrSEUVU8RJTraN8A5?cluster=devnet
- Review gate: REQUEST CHANGES nhẹ → fixed (null-status guard, catch gọn).
- A1 smoke (post container rebuild): drag-skip/cap/confirm/history ✅.

- [x] P0 contract (openapi + DTO + FE types/api + env keys): `done`
  (openapi 12 paths incl. history ✅; fixed pre-existing unquoted `:` in
  helius description; `tsc` BE+FE ✅)
- [x] P1 DB (`CopyOrder` + migration + regen): `done`
  (`20260930094154_copy_orders` applied on `fomo_dev:5433` ✅; client regen ✅;
  `tsc` BE ✅; fixed corrupted `model RealtimeEvent {` newline)
- [x] P2 executor + orchestration + TDD asserts: `done`
  (asserts ALL GREEN incl. happy CONFIRMED + FAILED-persist; `tsc` BE ✅)
- [x] P3 controller + API smoke: `done`
  (legacy sim unchanged ✅; paper no-confirm/gate-off → 400 envelopes ✅;
  history 200 empty + bad-limit fallback ✅; BE restarted to load routes)
- [x] P4 FE modal + un-veil + history: `done`
  (`CopyConfirmModal` + `CopyHistory` mới; veil/popup gỡ, panel live;
  `tsc` FE + `next build` ✅; `:3001` 200, veil absent ✅)
- [x] P5 devnet E2E + review gate + docs/indexes: `done`
  (E2E CLOSED 2026-10-02: vault funded 5 devnet SOL → order #4 CONFIRMED
  `5RYRk…8RJTraN8A5` finalized; review comments fixed; indexes updated.
  Cleanup 2026-10-05: checkbox tồn `in_progress` → `done`.)

## Handoff log

- 2026-09-30: plan written from bounded intent; infra pre-verified
  (PG 5433, Jupiter quote, devnet genesis). Approvals on file (protected,
  devnet-paper, 1-click, full). Starting P0.
- 2026-10-01 (P5b): vault local ROTATED + bàn giao owner (pubkey dưới).
  Helper gen đã xóa. Chờ: restart BE (root) + fund devnet.
  gate ON, key local-only. IP faucet 429 + Helius airdrop 500 → cần fund tay
  0.1–1 devnet SOL rồi chạy E2E (execute → verify sig → history → close).
