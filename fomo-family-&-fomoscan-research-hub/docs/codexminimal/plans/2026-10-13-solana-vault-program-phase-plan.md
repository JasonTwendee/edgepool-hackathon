# Phase Plan — Solana Vault Program (`edgepool_vault`)

Topic: `solana-vault-program` · Branch: **`feat/program-vault`** (KHÔNG merge vào main — user rule 2026-10-13)
Intent: `docs/codexminimal/idsd/2026-10-13-solana-vault-program-intent.md`
Design: `docs/architecture/SOLANA_PROGRAM_DESIGN.md` (v1.1 — source of truth)
Tracker: `docs/codexminimal/trackers/2026-10-13-solana-vault-program-tracker.md`

Approvals: user duyệt 2026-10-13 (system design v1.1 + "bắt đầu P0"). Protected-file
approvals riêng sẽ xin ở P2 (`.env.example`, `backend/src/config/*`) — chưa sửa gì ở plan này.

## Phase map

- **P0** — Toolchain + Anchor workspace + build xanh (no product behavior).
- **P1** — Program core ix 1–9 (vault/shares/deposit/withdraw/marks/settle/collect/sim-record)
  + Rust unit + LiteSVM suites + deploy devnet + devnet e2e script.
- **P2** — BE chain module: migration, indexer, keeper, faucet, reconcile job, config,
  pool-detail chain block, asserts + docs/ai index sync.
- **P3** — FE: chain client (IDL + anchor client), user-signed deposit/withdraw, badges/explorer/faucet, demo e2e.
- **P4** — Jupiter mainnet path: `execute_swap` + mock-CPI tests + dry-run tool + runbook (flag OFF).
- **P5** — Hardening: fuzz, threat-model doc, cost report, multisig/audit checklist.

## Dependencies

- P0 → P1 → (P2 ∥ P3 phần UI skeleton) → P3 full demo cần P2 API. P4 độc lập sau P1 (program) + P2 (BE config).
- P5 sau P1–P4. Real mainnet run KHÔNG thuộc plan này (runbook ở P4, user quyết sau).
- Mọi phase: commit trên `feat/program-vault`; review verdict required trước khi tick done
  (rust-code-reviewer cho P1/P4, nestjs-code-reviewer cho P2, reviewer generic cho P3/P5).

## Quality gates (từ IDSD)

- solution_challenger: DONE (D1–D12 trong intent) — không lặp lại.
- system_designer: DONE (SOLANA_PROGRAM_DESIGN.md v1.1).
- senior_qa (edge matrix): áp ở P1/P2/P4 theo acceptance A1–A10; verdict ở cuối mỗi phase.
- verifier: litesvm + devnet e2e + parity `assert-vault.ts` ↔ program.

---

## P0 executable steps (toolchain + workspace)

1. Cài Agave/Solana CLI: `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`;
   export PATH `~/.local/share/solana/install/active_release/bin`; verify `solana --version`,
   `cargo-build-sbf --version`. (anchor-cli 0.31.1 + rust đã có sẵn.)
2. Scaffold Anchor workspace tại project root (`fomo-family-&-fomoscan-research-hub/`):
   - `Anchor.toml`: `[workspace] members = ["programs/*"]`; `[provider] cluster = "devnet"`;
     `[programs.devnet] edgepool_vault = "<điền sau keygen>"`;
   - Root `Cargo.toml` workspace + `[profile.release]` (anchor defaults);
   - `programs/edgepool-vault/{Cargo.toml, src/lib.rs}` skeleton `edgepool_vault` (declare_id placeholder).
3. Keygen: `solana-keygen new -o target/deploy/edgepool_vault-keypair.json` (trong target/ → gitignored).
   Ghi pubkey vào `Anchor.toml` + `declare_id!`.
4. `.gitignore` bổ sung: `target/`, `.anchor/`, `test-ledger/`, `*keypair*.json` ngoài target.
5. Build đầu: `anchor build` xanh; IDL sinh tại `target/idl/edgepool_vault.json`.
6. Tạo `idls/` (root project) — copy IDL commit làm contract cho client:
   `idls/edgepool_vault.json` + note "regen sau mỗi thay đổi instruction".
7. Verify: `anchor build` PASS; `cargo test` (empty skeleton) PASS; `git status` sạch theo gitignore.

**Acceptance**: build + test pipeline chạy không cần solana-test-validator.
**Stop**: Agave install fail 2 lần → ghi blocker, xin user phương án (Codespace/CI).

## P1 executable steps (program core)

Files:
- `programs/edgepool-vault/src/{lib.rs, state.rs, math.rs, errors.rs, events.rs}`
- `src/instructions/{mod.rs, initialize_vault.rs, update_policy.rs, set_paused.rs, deposit.rs, withdraw.rs, update_marks.rs, settle_epoch.rs, collect_fees.rs, record_sim_trade.rs}`
- `tests/common/mod.rs` + suites `tests/{deposit.rs, withdraw.rs, fee.rs, marks.rs, pause.rs, lifecycle.rs}`

1. `state.rs`: `Vault` zero-copy `#[repr(C)]` đúng design §3.2 (manager, fee_sink, total_shares,
   hwm_price, marks_lamports, marks_slot, fee_credit, epoch, fee_bps, withdraw_fee_bps,
   reserve_bps, max_trade_bps, max_marks_bps, flags(u8 bit0 paused), env, bump) + `LEN` + consts:
   `MIN_DEPOSIT = 0.5 SOL`, `MAX_STALE_SLOTS = 750`, `MAX_MARK_DELTA_BPS = 2000`,
   `MIN_TREASURY_BUFFER = 0.01 SOL`, `MAX_NAME_LEN = 24`.
2. `math.rs` (pure, unit-testable): `nav = cash + marks − fee_credit`; `price_scaled` u128;
   `mint_for_deposit` (bootstrap = amount); `payout_for_shares` (floor); `perf_fee` u128;
   `touch_settle` (mutates fee_credit + hwm ratchet); checked ops — mọi hàm trả `Result<_, Error>`.
3. `errors.rs`: VaultPaused, NotKeeper, NotManager, StaleMarks, MarksCapExceeded,
   MarksDeltaExceeded, DepositTooSmall, InsufficientLiquidity, ReserveFloorBreached, NavInvalid,
   PayoutBelowMin, EnvMismatch, SwapTooLarge, SlippageExceeded, FeeExceedsCredit, MathOverflow,
   NameTooLong.
4. `events.rs`: compact theo design §6 (VaultInit, Deposit, Withdraw, Mark, EpochSettled,
   SimTrade, Paused, FeesCollected).
5. Instructions theo design §5 (rows 1–9), gates đúng thứ tự đã spec:
   - init: 4 PDA (vault `[b"vault", name]`, mint `[b"shares", vault]`, treasury `[b"treasury", vault]`,
     authority `[b"authority", vault]`), treasury rent-exempt, mint authority = authority;
   - deposit: !paused → min → freshness (marks>0) → touch_settle → transfer in → mint;
   - withdraw(shares, min_payout): balance → freshness → touch_settle → payout+fee →
     `paid ≥ min_payout` → cash ≥ paid + reserve floor + buffer → burn → transfer out;
   - update_marks: keeper role → delta cap → marks cap (nếu policy>0) → slot;
   - settle_epoch: touch_settle + epoch++ + event; collect_fees: ≤ fee_credit + cash;
   - record_sim_trade: keeper + env==devnet + event-only.
6. Rust unit tests (`src/math.rs` #[cfg(test)] hoặc `tests/`): bootstrap, mint/payout floor,
   HWM ratchet, phí 0 khi không vượt đỉnh, overflow u128.
7. LiteSVM integration — **spike đầu tiên**: xác nhận load được SPL Token program vào LiteSVM
   (`add_program_from_file` với token .so từ agave release, hoặc feature crate). Fallback nếu
   flaky: `solana-program-test` (bankrun) / `anchor test` local validator — chọn trong spike,
   ghi lại quyết định vào tracker.
8. Suites (negative bắt buộc theo A2–A4, A7, A9–A10):
   deposit ×(ok/min/paused/bootstrap/marks-stale); withdraw ×(ok/min_payout fail/insufficient
   liquidity/reserve/paused-vẫn-rút-được); fee (HWM ratchet/collect ≤ credit/cash-limited);
   marks ×(delta cap/cap policy/keep-out role); pause (deposit blocked/withdraw through);
   collect_fees; sim record (role + env).
9. Devnet deploy: `solana airdrop` cho deploy fee payer (cần ~3–6 SOL; nếu faucet limit →
   nhiều lần hoặc ví đã có) → `anchor deploy --provider.cluster devnet` → cập nhật
   `[programs.devnet]` + commit IDL mới vào `idls/`.
10. `backend/package.json` + `@coral-xyz/anchor` (khớp web3.js hiện có); script
    `backend/scripts/chain/devnet-e2e.ts`: init vault (env=0) → airdrop user → deposit 1 SOL →
    `update_marks` → `settle_epoch` → withdraw kèm min_payout → asserts (ATA balance, event
    logs, mint supply == total_shares, treasury delta đúng) — chạy `npx tsx`.
11. Parity: cùng scenario "loss-then-exit" trong `assert-vault.ts` (off-chain) ↔ litesvm test
    mới → số khớp (trừ rounding 1e-9) — ghi bảng so sánh vào tracker.

**Verification**: `anchor build`; `cargo test` (tất cả suites); `anchor deploy devnet`;
`npx tsx backend/scripts/chain/devnet-e2e.ts` (log assert); parity bảng.
**Acceptance**: A1, A2, A3, A4 xanh trên devnet; A7 (fee) xanh; A9 (min_payout) xanh.
**Stop**: LiteSVM token-program spike fail 2 hướng → fallback bankrun/validator, ghi lý do;
devnet airdrop không đủ → xin user ví có SOL devnet.

## P2 executable steps (BE chain module)

0. **Xin approval** sửa protected: `backend/.env.example` + `backend/src/config/*`
   (thêm `CHAIN_ENABLED=false, CHAIN_CLUSTER=devnet, PROGRAM_ID, KEEPER_KEY, MAX_STALE_SLOTS,
   JUPITER_SWAP_API_URL, MAINNET_SWAP_ENABLED=false`) — default toàn bộ OFF.
1. Migration MỚI `backend/prisma/migrations/<ts>_chain_vault_program/migration.sql`:
   - `vaults` + `chain_program_id/chain_vault/chain_env VARCHAR(64/64/10) NULL`, `chain_paused BOOLEAN NULL`;
   - `deposits`/`withdrawals` + `chain_sig VARCHAR(96) NULL`, `chain_slot BIGINT NULL`;
   - `epoch_checkpoints` + `chain_sig VARCHAR(96) NULL`;
   - `chain_events` table + `@@unique([signature, ix_index, event_index])` + index vault_id/kind;
   - schema.prisma cập nhật + regen client (committed); không sửa migration cũ.
2. `backend/src/modules/chain/`:
   - `chain.config.ts` (đọc qua `src/config/`), `program.client.ts` (AnchorProvider + IDL từ
     `backend/src/chain/idl/` hoặc đọc `idls/`, keeper keypair base58, PDA derive helpers,
     event parser từ program logs);
   - `indexer.service.ts`: `onLogs` + backfill `getSignaturesForAddress`; parse event → upsert
     `chain_events` (idempotent) → mirror rows: deposit/withdrawal `SETTLED` + `chain_sig/slot`,
     epoch checkpoint, vault `chain_paused`; heal 60s;
   - `keeper.service.ts`: tick 30–60s cho vault chain: tính `marks = Σ MTM paper positions`
     (đọc qua service hiện có, read-only), `update_marks`; settle cadence; kill-switch →
     `set_paused`; `record_sim_trade` khi có ladder action mới (theo con trỏ last-processed);
   - `reconcile.service.ts`: 5 check design §7.5B + alert log (lệch → warn + audit row);
   - `faucet.controller.ts`: `POST /api/chain/faucet` (AuthGuard, genesis-gate như
     paper-executor, rate-limit/24h, chỉ cluster devnet).
3. `vaults.service.ts#poolDetail`: thêm block `chain { programId, vault, price, marks, paused,
   env, explorerUrl }` khi `chainVault != null` (không đổi shape cũ khi null).
4. `openapi.yaml`: thêm `/api/chain/faucet` + chain block trong pool detail + error cases.
5. Asserts `chain/assert-chain.ts` (mock, không network): logs fixture → event mapping;
   idempotency (cùng event 2 lần → 1 row); mirror rows đúng; reconcile 5 check xanh + lệch
   giả lập → alert; faucet genesis gate; marks computation từ paper positions.
6. Docs/ai sync (repo rule — cùng commit): module-index (chain module), route-index (faucet +
   chain block), entity-index (chain_events + cột mới), test-index (assert-chain),
   context-map.json (modules/routes/services), stack-profile (Rust+Anchor evidence).
7. Verify: BE typecheck; `npx tsx src/modules/chain/assert-chain.ts`; full assert sweep;
   `migrate deploy` trên compose DB; boot smoke `/api/health`; keeper tick thật 1 lần lên devnet
   (marks đổi trên chain — đối chiếu explorer).

**Acceptance**: A5 (signal → BE → marks on-chain + mirror DB) + A10 (reconcile xanh).
**Stop**: indexer không parse được event format → freeze event schema + fix parser (không đổi program);
migration fail 2 lần → dừng, báo user.

## P3 executable steps (FE user-signed flow)

1. `frontend/package.json` + `@coral-xyz/anchor` + `@solana/web3.js`; copy IDL →
   `frontend/lib/idl/edgepool_vault.json`.
2. `frontend/lib/chain.ts`: connection (devnet), Program, PDA helpers, `buildDepositTx`,
   `buildWithdrawTx(shares, minPayout)`; send qua `window.solana.signAndSendTransaction` (pattern
   `lib/solana.ts` sẵn có); confirm poll; map Anchor error → message tiếng Việt.
3. `frontend/lib/api.ts` + `types/fund.ts`: `chainFaucet()`, `ChainVaultInfo`.
4. `frontend/app/pools/[id]/page.tsx`: khi pool.chain → modal Deposit/Withdraw chạy wallet flow:
   estimate + min_payout mặc định (=estimate − 0.5%), trạng thái ký/gửi/confirm, link explorer,
   nút "Get devnet SOL" khi balance thấp; badge `ON-CHAIN · DEVNET`; errors hiển thị nguyên văn.
5. Demo click-through devnet (script docs/setup hoặc tracker note): faucet → deposit → admin
   keeper tick (marks) → withdraw thấy min_payout hoạt động.
6. Verify: FE typecheck + `next build`; BE+FE full typecheck; smoke pool detail (chain block).

**Acceptance**: A1/A2 từ UI thật (ví Phantom/OKX browser); A5 end-to-end demo.
**Stop**: ví browser không ký được trong môi trường test → fallback local keypair sign cho demo,
ghi rõ gap (như tiền lệ trader portal).

## P4 executable steps (Jupiter mainnet path, gated)

1. Program `execute_swap(amount_in, min_out, route_data)` + wrap/unwrap WSOL + caps
   (`≤ max_trade_bps × NAV`) + min_out verify sau CPI + pause/env gates + `SwapExecuted`.
2. LiteSVM: deploy **mock Jupiter program** trong test (nhận account list, chuyển token theo
   tỷ lệ cố định) → test buy/sell/min_out fail/caps/pause/env gate; test wrap/unwrap balance delta.
3. `backend/scripts/chain/jupiter-dry-run.ts`: quote thật từ lite-api → swap-instructions →
   build anchor ix (remaining_accounts + route data) → in base64 + account count + size;
   **không gửi**; fail-soft nếu route > tx limit (ghi log).
4. Runbook mới `docs/setup/CHAIN_MAINNET_RUNBOOK.md` (SSOT cho chain ops): checklist bật mainnet
   (audit xong + multisig + caps review + Jito config + test $ nhỏ + monitoring), quy trình
   collect_fees split, kill-switch escalation, rollback (pause toàn bộ).
5. Verify: `cargo test` mock-CPI suites xanh; dry-run in tx build OK; runbook review với user.

**Acceptance**: A6 (mock CPI + dry-run) — mainnet vẫn OFF.
**Stop**: route phổ biến không fit 1 CPI tx → ghi limitation + phương án split v2, không tự ý
tăng scope.

## P5 executable steps (hardening)

1. Fuzz proptest cho `math.rs` (mint/payout/fee paths): panic-free + invariants (price không
   âm; supply mirror; fee ≤ profit).
2. Threat-model doc chốt từ design §8 + checklist audit ngoài (scope brief = design doc).
3. Cost report: đo rent + fee thực tế devnet cho init/deposit/withdraw/keeper tick/swap-mock →
   bảng vào design doc appendix.
4. Multisig/audit checklist: các bước Squads + upgrade authority transfer (doc-only, chưa chạy).
5. Verify: toàn bộ `cargo test` + asserts + typecheck xanh; report committed.

**Acceptance**: báo cáo + checklist hoàn tất; không còn TODO chặn audit.

## Verification commands (tổng)

```bash
# Program
cd programs/edgepool-vault && cargo test
anchor build && anchor deploy --provider.cluster devnet
# BE
npm --prefix backend run typecheck
cd backend && npx tsx src/modules/chain/assert-chain.ts && npx tsx scripts/chain/devnet-e2e.ts
# FE
npm --prefix frontend run typecheck && npm --prefix frontend run build
# Parity
cd backend && npx tsx src/modules/vaults/assert-vault.ts   # + bảng đối chiếu litesvm trong tracker
```

## Space / artifact policy (máy user dung lượng hạn chế — 2026-10-13)

- Xóa được bất cứ lúc nào (tự tái tạo, không ảnh hưởng correctness):
  - `target/` → `cargo clean` (rebuild từ đầu 2–5 phút; `.so` build lại được);
  - `~/.cache/solana/v1.57` (platform-tools ~1.7G) → lần build sau tự re-download;
  - `~/.cargo/registry` (~200M) → lần build sau tự re-download.
- **KHÔNG BAO GIỜ xóa**: `target/deploy/edgepool_vault-keypair.json` — backup bắt buộc
  tại `~/.config/solana/edgepool_vault-keypair.json` (đã copy 2026-10-13, pubkey
  `5zkeKsj…s3CQ`). Nếu `cargo clean`: **restore keypair từ backup vào `target/deploy/`**
  trước lần build/deploy kế tiếp.
- Thứ tự dọn khi cần space: 1) `cargo clean` → 2) platform-tools → 3) registry.
- Trong lúc dev (P1–P4): giữ cache để build nhanh; chỉ dọn ở checkpoint, không dọn giữa phase đang chạy.

## Global stop conditions

- Trùng intent stop: LiteSVM flaky 2 hướng → bankrun/validator + ghi quyết định.
- Devnet deploy/airdrop block quá 1 ngày → xin user ví có SOL hoặc CI deploy.
- Scope drift (queue on-chain, ladder on-chain, mainnet thật) → dừng, intent mới.
- Review verdict ≠ APPROVE → không tick phase.
- Protected files: chỉ sửa sau approval riêng (P2 bước 0).

## Handoff notes

- Reviewer skills: P1/P4 `rust-code-reviewer`; P2 `nestjs-code-reviewer`; P3/P5 reviewer generic.
- Mỗi phase commit riêng trên `feat/program-vault` (message theo style repo: `Solana vault program: <phase> …`).
- cập nhật tracker + telemetry + current-work sau mỗi phase; docs/ai từ P2 bắt buộc.
