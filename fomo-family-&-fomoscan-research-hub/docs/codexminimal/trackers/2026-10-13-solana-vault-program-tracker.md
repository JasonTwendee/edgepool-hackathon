# Tracker — Solana Vault Program (`edgepool_vault`)

Topic: solana-vault-program | Branch: **`feat/program-vault`** (không merge main) | Intent: `docs/codexminimal/idsd/2026-10-13-solana-vault-program-intent.md` | Plan: `docs/codexminimal/plans/2026-10-13-solana-vault-program-phase-plan.md` | Design: `docs/architecture/SOLANA_PROGRAM_DESIGN.md` v1.1

## Status

- [x] P0 toolchain + Anchor workspace + build xanh
- [x] P1 program core + tests + **deploy devnet ✅** + **e2e devnet PASS ✅** (26/26 tests, slot 510563107)
- [x] P2 BE chain module: migration, indexer, keeper, faucet, reconcile + asserts
- [ ] P3 FE chain client + user-signed deposit/withdraw + demo e2e
- [ ] P4 Jupiter `execute_swap` + mock-CPI + dry-run + runbook (flag OFF)
- [ ] P5 fuzz + threat model + cost report + multisig/audit checklist

## Handoff log

- P2 done (BE chain module): `backend/src/modules/chain/` (program client + indexer/backfill/mirror + keeper 45s + reconcile 5 checks + faucet devnet) + migration `20261015000000_chain_vault_program` + `chain_events` + poolDetail `chain` block + openapi `/api/chain/faucet` (71 paths) + `assert-chain.ts` ALL GREEN + prisma validate/typecheck xanh + nestjs-code-reviewer self-review (1 fix: sim-trade bỏ mint fallback). Protected chạm có approval: `.env.example` + `src/config/*` (CHAIN_* OFF mặc định). Chưa apply migration lên DB local (làm khi dựng P2 e2e).

- 2026-10-13: intent + system design v1.1 approved; branch `feat/program-vault` created từ main@948eadf; design docs committed (`5ca56d3`). Plan written. Bắt đầu P0.
- 2026-10-13 P0 done: Agave CLI **4.3.0** + `cargo-build-sbf` 4.4.0 (platform-tools v1.57) cài mới; rustup default stable 1.99.0 (máy chưa có default toolchain); Anchor workspace scaffold tại project root (`Anchor.toml` + `Cargo.toml` workspace + `programs/edgepool-vault` skeleton, program id `5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ`, keypair trong `target/deploy` — gitignored); `anchor build` **PASS** (`.so` 151KB + IDL + TS types); `cargo test` PASS (0 tests — skeleton); IDL commit tại `idls/edgepool_vault.json`; PATH Agave thêm vào `~/.bashrc`.
- 2026-10-13 P0 vận hành: root fs chỉ còn ~1.9G → platform-tools unpack fail lần 1; đã relocate tạm `~/.cache/solana`, `~/.cargo/registry`, project `target/` sang `/media/jason/Acer/edgepool-build/` bằng **symlink** (không xóa dữ liệu, reversible) → root còn ~7.3G. *(Đã revert cùng ngày — xem log dưới.)*
- 2026-10-13: `anchor build` output xác nhận anchor-lang **0.31.2** resolve (Cargo.lock) — tương thích Agave 4.3 platform-tools v1.57, không cần pin solana 2.x.
- 2026-10-13 (space) P0 vận hành 2: user giải phóng ổ chính (~20G trống) → **toàn bộ cache/build chuyển về ổ chính**; gỡ symlink, xóa sạch `/media/jason/Acer/edgepool-build`; sửa symlink lạc `~/.cache/solana/solana-cache` (platform-tools thực ra luôn nằm ổ chính — 1.7G); **backup keypair program** tại `~/.config/solana/edgepool_vault-keypair.json` (pubkey `5zkeKsj…s3CQ`, mode 600) — không bao giờ xóa; policy dọn artifacts ghi ở plan §Space policy; `anchor build` incremental PASS sau di chuyển.
- 2026-10-13 P1a (program core) done: 9 instructions + events + math u128 + errors; **26/26 tests GREEN** (12 unit math + 14 LiteSVM: lifecycle 6 + gates 8). Divergences có chủ đích (đã cập nhật design doc §3.2/§9/§10): (1) Borsh account chuẩn thay zero-copy — cùng byte size, hoãn tối ưu compute; (2) thêm field `keeper` (+32B → Vault 165B/rent ~0.0020 SOL) tách role keeper/manager; (3) SBF build **arch v2** qua `scripts/program-build.sh` — cargo-build-sbf 4.4 mặc định v3, không load được trong LiteSVM 0.7 (loader 2.3); (4) fixture `tests/fixtures/spl_token.so` + `spl_ata.so` dump devnet override built-in token 3.5.0 (thiếu InitializeMint2 mà anchor-spl dùng); (5) `expire_blockhash` mỗi tx trong test harness (LiteSVM dedupe theo signature).
- 2026-10-13 P1a chi tiết kỹ thuật: anchor 0.31 `#[program]` cần `crate::__client_accounts_*` → `instructions/mod.rs` phải `pub use x::*` (pattern multi-file); `InitializeMint2` bắt buộc (anchor-syn 0.31); ATA program dùng built-in 1.1.1.
- 2026-10-13 P1b **deploy devnet done** (user approval: dùng ví demo project nạp deploy fee): program `5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ` owner `BPFLoaderUpgradeab1e…`, programdata `CHni8wtw1X4KbwHuGv53zFL71KuX3TP3x7cQRgcE7L1W`, upgrade authority `HZnmfeEVCzLNY5m8zXLEzTErGtLYLR1GJ4iXj5EiqVZ9` (CLI wallet), data 313,688 bytes, slot 510,563,107, deploy sig `3UBmNJ5HUcJ3RaJznWD44t5dgeQ8G4PZtWPWsk91qbEDn7Sxgvp5EZN4zLS1zP73wgEVviF78HQcnXgCCcZ5ayoG`. Funding: 2.5 devnet SOL từ ví demo `6QbrpP2CKf76dE92RrdhBucpeuq4kDBEfDuMf7a9N5pM` (VAULT_PRIVATE_KEY, user-approved) → CLI wallet; số dư còn: CLI 1.32 SOL · demo 2.50 SOL. Faucet CLI rate-limit (không dùng được). Ví demo keypair tạm ở `/tmp/opencode/vault-demo.json` (chmod 600) — nhớ xóa khi xong session.
- 2026-10-13 P1c **e2e devnet PASS** — `backend/scripts/chain/devnet-e2e.ts` chạy trọn vòng đời trên devnet thật (vault `F7gv8wotayAfHhQoMVirQb9Wr1NmSjRmqe5rL2ENunGd`, name `e2emv6f2dok`): init ✓ → deposit 0.6 ✓ → marks 0.1 ✓ → settle (phí 0.0220, HWM 1.1467) ✓ → withdraw 0.3 nhận **0.3440 SOL khớp chính xác tính tay** (min_payout 0.3423) ✓ → record_sim_trade ✓ → collect_fees ✓. Số dư sau run: CLI payer 0.6183 SOL · demo wallet 2.2423 SOL.
- 2026-10-13 P1c bài học vận hành: (1) **bn.js của anchor: `.eqn(number)` HỎNG với number > 2^26** (1e9 lamports!) — dùng `.eq(number)`/`.eq(new BN(x))` trong mọi client BE/FE; (2) run e2e đầu tiên generate user keypair rồi vứt → mất 0.7 devnet SOL (script đã sửa: dùng ví demo từ `backend/.env`, fallback lưu keypair vào `/tmp/opencode/e2e-user.json`); (3) `@coral-xyz/anchor` là CJS — trong Node ESM phải `createRequire`.
- 2026-10-13 P1 review (rust-code-reviewer checklist, findings-only self-review): **APPROVE** — xem §Review verdict.

## Review verdict

**APPROVE** — rust-code-reviewer checklist (findings-only self-review, 2026-10-13), không có critical issue:

- Correctness: u128 checked toán học; floor có lợi vault (mint floor + payout floor) → giá không giảm sau mọi cặp mint/burn; không có đường nào đưa NAV âm (withdraw ≤ NAV; collect giảm cash+fee_credit song song; marks delta ≤ 20% NAV cũ). `touch_settle` tính lại NAV sau khi mutate fee_credit — đúng thứ tự.
- Auth: `has_one` manager/keeper trên mọi ix role; user ATA ràng buộc `mint + authority = user`; `fee_sink` pinned bằng `address` constraint; treasury/mint/authority bind theo `vault.key()` seeds.
- Không `unsafe`, không `unwrap` trong program code; lỗi qua `Result`/`require!`; test 26/26 + e2e thật.
- Known limitations chấp nhận v1 (ghi nhận, không chặn): (1) `MIN_TREASURY_BUFFER` khiến holder cuối không rút được ~0.01 SOL buffer (v2: cho full-exit khi burn == total_shares); (2) `fee_sink` bất biến sau init (= manager — split 80/15/5 off-chain); (3) `collect_fees` không giữ buffer (theo thiết kế cash-limited — đã test).
- Protected files: không chạm (e2e đọc `.env` chỉ đọc; script không chứa secret).

## Divergences / notes

- Rule branch (user 2026-10-13, siết lại cùng ngày): `feat/program-vault` là **local-only** — không push remote (kể cả branch), không merge vào `main`; mọi commit chỉ nằm local trên branch này.
- Space policy (user rule 2026-10-13): `cargo clean` được phép bất cứ lúc nào; **không bao giờ xóa keypair**; backup ở `~/.config/solana/edgepool_vault-keypair.json`; chi tiết plan §Space / artifact policy.
- Patch v1.1 (min_payout, max_marks_bps, reconcile 3 tầng) là phần của baseline P1/P2, không phải scope mới.

## Test gaps

- Chưa có test: same-user deposit lần 2 (đường `init_if_needed` với ATA đã tồn tại) · `update_marks` khi NAV = 0 (chỉ cho phép marks = 0) · `collect_fees` khi paused (theo thiết kế vẫn chạy vì không check pause) · full-exit holder cuối (buffer dust — known limitation).
- Phân phối phí nhiều holders chưa test riêng (suites chỉ 1–2 holders) — cover gián tiếp qua công thức pro-rata qua shares.
- Mainnet swap path chưa tồn tại (P4) — ngoài scope P1.

## Next phase

P2 — BE chain module: migration (`chain_*` cols + `chain_events`), indexer (onLogs + backfill + idempotent),
keeper (marks/settle/kill-switch/sim records), faucet, `chain-reconcile` job, config (protected — xin approval),
pool detail `chain` block + docs/ai sync. Nhớ: client BE phải tránh `BN.eqn(number > 2^26)`.

**Work plan (report-ready, EN):** `programs/edgepool-vault/ROADMAP.md` — 4 tuần × 20 ngày × 4 đầu việc = 80 items; tuần 1 = contract build-out (đã xong).
