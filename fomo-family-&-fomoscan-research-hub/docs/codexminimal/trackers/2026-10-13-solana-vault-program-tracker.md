# Tracker — Solana Vault Program (`edgepool_vault`)

Topic: solana-vault-program | Branch: **`feat/program-vault`** (không merge main) | Intent: `docs/codexminimal/idsd/2026-10-13-solana-vault-program-intent.md` | Plan: `docs/codexminimal/plans/2026-10-13-solana-vault-program-phase-plan.md` | Design: `docs/architecture/SOLANA_PROGRAM_DESIGN.md` v1.1

## Status

- [x] P0 toolchain + Anchor workspace + build xanh
- [ ] P1 program core + tests + **deploy devnet ✅** (26/26 green, slot 510563107) — còn e2e script (bước cuối P1)
- [ ] P2 BE chain module: migration, indexer, keeper, faucet, reconcile + asserts
- [ ] P3 FE chain client + user-signed deposit/withdraw + demo e2e
- [ ] P4 Jupiter `execute_swap` + mock-CPI + dry-run + runbook (flag OFF)
- [ ] P5 fuzz + threat model + cost report + multisig/audit checklist

## Handoff log

- 2026-10-13: intent + system design v1.1 approved; branch `feat/program-vault` created từ main@948eadf; design docs committed (`5ca56d3`). Plan written. Bắt đầu P0.
- 2026-10-13 P0 done: Agave CLI **4.3.0** + `cargo-build-sbf` 4.4.0 (platform-tools v1.57) cài mới; rustup default stable 1.99.0 (máy chưa có default toolchain); Anchor workspace scaffold tại project root (`Anchor.toml` + `Cargo.toml` workspace + `programs/edgepool-vault` skeleton, program id `5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ`, keypair trong `target/deploy` — gitignored); `anchor build` **PASS** (`.so` 151KB + IDL + TS types); `cargo test` PASS (0 tests — skeleton); IDL commit tại `idls/edgepool_vault.json`; PATH Agave thêm vào `~/.bashrc`.
- 2026-10-13 P0 vận hành: root fs chỉ còn ~1.9G → platform-tools unpack fail lần 1; đã relocate tạm `~/.cache/solana`, `~/.cargo/registry`, project `target/` sang `/media/jason/Acer/edgepool-build/` bằng **symlink** (không xóa dữ liệu, reversible) → root còn ~7.3G. *(Đã revert cùng ngày — xem log dưới.)*
- 2026-10-13: `anchor build` output xác nhận anchor-lang **0.31.2** resolve (Cargo.lock) — tương thích Agave 4.3 platform-tools v1.57, không cần pin solana 2.x.
- 2026-10-13 (space) P0 vận hành 2: user giải phóng ổ chính (~20G trống) → **toàn bộ cache/build chuyển về ổ chính**; gỡ symlink, xóa sạch `/media/jason/Acer/edgepool-build`; sửa symlink lạc `~/.cache/solana/solana-cache` (platform-tools thực ra luôn nằm ổ chính — 1.7G); **backup keypair program** tại `~/.config/solana/edgepool_vault-keypair.json` (pubkey `5zkeKsj…s3CQ`, mode 600) — không bao giờ xóa; policy dọn artifacts ghi ở plan §Space policy; `anchor build` incremental PASS sau di chuyển.
- 2026-10-13 P1a (program core) done: 9 instructions + events + math u128 + errors; **26/26 tests GREEN** (12 unit math + 14 LiteSVM: lifecycle 6 + gates 8). Divergences có chủ đích (đã cập nhật design doc §3.2/§9/§10): (1) Borsh account chuẩn thay zero-copy — cùng byte size, hoãn tối ưu compute; (2) thêm field `keeper` (+32B → Vault 165B/rent ~0.0020 SOL) tách role keeper/manager; (3) SBF build **arch v2** qua `scripts/program-build.sh` — cargo-build-sbf 4.4 mặc định v3, không load được trong LiteSVM 0.7 (loader 2.3); (4) fixture `tests/fixtures/spl_token.so` + `spl_ata.so` dump devnet override built-in token 3.5.0 (thiếu InitializeMint2 mà anchor-spl dùng); (5) `expire_blockhash` mỗi tx trong test harness (LiteSVM dedupe theo signature).
- 2026-10-13 P1a chi tiết kỹ thuật: anchor 0.31 `#[program]` cần `crate::__client_accounts_*` → `instructions/mod.rs` phải `pub use x::*` (pattern multi-file); `InitializeMint2` bắt buộc (anchor-syn 0.31); ATA program dùng built-in 1.1.1.
- 2026-10-13 P1b **deploy devnet done** (user approval: dùng ví demo project nạp deploy fee): program `5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ` owner `BPFLoaderUpgradeab1e…`, programdata `CHni8wtw1X4KbwHuGv53zFL71KuX3TP3x7cQRgcE7L1W`, upgrade authority `HZnmfeEVCzLNY5m8zXLEzTErGtLYLR1GJ4iXj5EiqVZ9` (CLI wallet), data 313,688 bytes, slot 510,563,107, deploy sig `3UBmNJ5HUcJ3RaJznWD44t5dgeQ8G4PZtWPWsk91qbEDn7Sxgvp5EZN4zLS1zP73wgEVviF78HQcnXgCCcZ5ayoG`. Funding: 2.5 devnet SOL từ ví demo `6QbrpP2CKf76dE92RrdhBucpeuq4kDBEfDuMf7a9N5pM` (VAULT_PRIVATE_KEY, user-approved) → CLI wallet; số dư còn: CLI 1.32 SOL · demo 2.50 SOL. Faucet CLI rate-limit (không dùng được). Ví demo keypair tạm ở `/tmp/opencode/vault-demo.json` (chmod 600) — nhớ xóa khi xong session.
- 2026-10-13 P1 còn lại: e2e script `backend/scripts/chain/devnet-e2e.ts` (anchor client: init → faucet → deposit → update_marks → settle → withdraw + asserts) — chưa làm.

## Review verdict

(chưa — verdict per phase; reviewer: rust-code-reviewer P1/P4, nestjs-code-reviewer P2)

## Divergences / notes

- Rule branch: user yêu cầu 2026-10-13 — không merge vào main; mọi commit chỉ trên `feat/program-vault`.
- Space policy (user rule 2026-10-13): `cargo clean` được phép bất cứ lúc nào; **không bao giờ xóa keypair**; backup ở `~/.config/solana/edgepool_vault-keypair.json`; chi tiết plan §Space / artifact policy.
- Patch v1.1 (min_payout, max_marks_bps, reconcile 3 tầng) là phần của baseline P1/P2, không phải scope mới.

## Test gaps

- (chưa có — cập nhật theo phase)

## Next phase

P1 — program core ix 1–9 + Rust unit + LiteSVM suites + deploy devnet + e2e script.
Bắt đầu bằng spike: xác nhận SPL Token program load được vào LiteSVM (fallback: bankrun/validator).
