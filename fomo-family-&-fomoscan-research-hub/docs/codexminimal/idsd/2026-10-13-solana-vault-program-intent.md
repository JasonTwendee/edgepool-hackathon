# IDSD Intent Contract — Solana Vault Program (`edgepool_vault`)

> Topic: on-chain vault program + devnet integration (deposit/withdraw SOL, copy-trade sim với data mainnet, Jupiter mainnet CPI gated)
> Ngày: 2026-10-13 · Trạng thái: intent chốt — chờ review system design → repo-phase-orchestrator

## Intent

Triển khai Solana program (Anchor) làm **vault giữ tiền** cho Edgepool, thay thế dần kế toán
off-chain bằng on-chain custody + share SPL, với 4 nhóm tính năng:

1. **Vault contract giữ tiền**: treasury PDA giữ SOL; program là authority duy nhất chi tiền
   (mint/burn share, execute swap, collect fee).
2. **Nạp/rút SOL trên Devnet**: user ký tx từ ví (Phantom/Solflare), share SPL (vSHARE)
   mint/burn tại giá MTM hiện tại; BE cấp faucet devnet + indexer + keeper.
3. **Mô phỏng copy trade trên Devnet với data Mainnet**: tín hiệu + ladder vẫn ở BE
   (theo chuẩn hiện tại); program chỉ lưu state tối thiểu (marks keeper-đẩy) + event nén
   làm audit trail on-chain; deposit/withdraw priced theo NAV = cash + marks.
4. **Trade qua Jupiter Mainnet bằng contract (cần SOL thật)**: `execute_swap` CPI vào
   Jupiter v6, feature-gate kín (env bất biến + production flag + caps + audit gate);
   code-complete trong đợt này, **không bật mainnet** cho đến khi user quyết định vốn thật.

## Business Rules

- BR1: Share = SPL Token mint riêng mỗi vault, decimals 9 (1 share = 1e9 raw).
  Authority mint = `vault_authority` PDA. User giữ share trong ATA của chính mình.
- BR2: Giá = NAV / tổng shares. NAV = treasury_lamports + marks_lamports − fee_credit.
  Bootstrap (supply = 0): giá 1 SOL = 1 share.
- BR3: Deposit tối thiểu **0.5 SOL** (khớp gate off-chain). Deposit bị chặn khi paused;
  **withdraw KHÔNG BAO GIỜ bị chặn** (thoát vốn là quyền tối thượng).
- BR4: Rút: burn đúng số share user yêu cầu (≤ balance), payout = shares × giá tại thời điểm
  lệnh, **exact amount**; kèm **`min_payout`** (slippage guard phía user — payout thấp hơn
  ngưỡng → revert `PayoutBelowMin`); thiếu cash → tx fail (`InsufficientLiquidity`) — keeper
  chịu trách nhiệm giữ buffer/liquidate; không queue on-chain ở v1.
- BR5: Phí hiệu suất trên lãi mới vượt HWM (`fee_bps`, ví dụ 2000 = 20%); fee accrues vào
  `fee_credit`, chi trả thật khi `collect_fees` (cash-limited). HWM ratchet sau phí.
  Split 80/15/5 giữa depositors/trader/edgepool **vẫn tính off-chain** (DB) — on-chain chỉ
  thu về `fee_sink` (ví treasury của team).
- BR6: Marks (giá trị positions) chỉ keeper đẩy được; freshness bắt buộc khi marks > 0
  (chặn stale pricing); delta mỗi lần đẩy bị cap (chống keeper lạm dụng); trần
  **`max_marks_bps` so với cash** (policy sim, 0 = tắt) giới hạn nghĩa vụ lãi mô phỏng.
- BR7: Kill-switch: pause chặn deposit + swap; withdraw vẫn chạy (đúng mô hình BE hiện tại).
- BR8: `execute_swap` chỉ khi: env = Mainnet (bất biến lúc init), production_enabled = 1,
  !paused, keeper ký, amount ≤ max_trade_bps × NAV, min_out > 0 kiểm tra sau CPI.
- BR9: Off-chain engine giữ nguyên (dual-mode). Chain-backed pool là opt-in
  (`Vault.chainVault != null`); pool off-chain cũ chạy y như trước, không big-bang.

## Non-Goals (đợt này)

- Không audit ngoài, không bật mainnet, không nạp SOL thật (code-complete + gate).
- Không đưa ladder TP1/TP2/stop/trail/time lên on-chain (user chốt: tối ưu ở BE).
- Không on-chain fee split chi tiết cho từng partner (giữ accrual DB như hiện tại).
- Không liquidation queue / withdraw queue on-chain ở v1.
- Không governance/multisig upgrade trước mainnet launch (Squads là phase riêng sau audit).
- Không SPL Token-2022, không token khác ngoài SOL + SPL token mua qua Jupiter.

## Constraints

- Anchor 0.31.1 (đã có CLI); **Agave/Solana CLI chưa cài → phase 0 phải cài**.
- Repo layout chuẩn Anchor tại root của hub: `Anchor.toml`, `programs/edgepool-vault/`,
  `tests/` (LiteSVM), IDL commit cho client.
- Byte/rent tối giản: state pack chặt (zero-copy), không string/Vec trong account, không
  lưu Pubkey suy ra được (mint/treasury/authority đều derivable), event nén, tối thiểu account.
- User-signed flow: tx deposit/withdraw do **user ký và gửi** (ví trực quan); BE không
  ký hộ các tx này. Keeper/manager ops do BE key ký (vai trò khác).
- Protected files sẽ phải sửa (cần approval khi tới phase): `.env.example`,
  `backend/src/config/*`; migration mới (không sửa migration cũ).
- API contract: openapi.yaml là nguồn chân lý duy nhất; mọi endpoint mới phải vào đó.
- Không đụng module `copy-trade/**` (protected) trong đợt này trừ khi có approval riêng.

## Acceptance Criteria

| # | Tiêu chí | Bằng chứng |
|---|---|---|
| A1 | Deposit devnet ≥ 0.5 SOL từ ví user → shares mint đúng công thức (bootstrap + có epoch) | devnet e2e script: số dư ATA + event log khớp tính tay |
| A2 | Withdraw burn shares, payout exact theo giá hiện tại; thiếu cash → lỗi rõ ràng, UI hiển thị | litesvm negative test + devnet e2e |
| A3 | Marks update → NAV/giá đổi; marks stale khi > 0 → chặn deposit/withdraw (fail-closed) | litesvm tests + e2e |
| A4 | Pause chặn deposit + swap, không chặn withdraw | litesvm + e2e |
| A5 | Tín hiệu mainnet → BE ladder → `record_sim_trade` event + marks on-chain devnet + mirror DB | e2e demo scenario end-to-end |
| A6 | `execute_swap`: mock Jupiter CPI chứng minh wrap/buy/sell/unwrap + caps + min_out + pause; mainnet tx dry-run build từ Jupiter quote thật (không gửi) | litesvm tests + dry-run script log |
| A7 | HWM fee đúng: fee chỉ trên lãi mới, ratchet, collect ≤ credit, cash-limited | litesvm + assert parity với `assert-vault.ts` off-chain |
| A8 | Off-chain pools không bị ảnh hưởng (regression) | typecheck + assert suites cũ xanh |
| A9 | Withdraw `min_payout`: revert khi payout thật < ngưỡng (kể cả khi marks bị hạ ngay trước tx) | litesvm negative test + devnet e2e |
| A10 | `max_marks_bps`: keeper không đẩy được marks vượt trần; reconcile job 5 check xanh, lệch giả lập → alert | litesvm + assert fixture `chain-reconcile` |

## Architecture Decision (ADR-style — chi tiết ở SOLANA_PROGRAM_DESIGN.md)

| # | Decision | Options | Chốt | Lý do | Risk |
|---|---|---|---|---|---|
| D1 | Framework | Anchor 0.31.1 / native Rust | **Anchor** | CLI có sẵn, ecosystem, IDL cho clients | Version pin, platform-tools |
| D2 | Share | SPL mint decimals 9 / ledger nội bộ | **SPL mint** | Composability, ví hiển thị, khớp design doc cũ | Burn cần user ký (đã chấp nhận: user-signed) |
| D3 | Ký tx | User tự ký+gửi / BE relay fee-payer / zero-popup intent | **User tự ký + gửi** | Trực quan nhất cho demo; non-custodial thật; bỏ complexity partial-sign | User cần devnet SOL → có faucet BE |
| D4 | Settle | Queue on-chain / instant MTM | **Instant MTM, fill-or-fail** | Khớp rule 2026-10-12 off-chain; không queue accounts | Rút bị chặn khi thiếu cash → keeper phải giữ buffer |
| D5 | Copy-sim | Ladder on-chain / BE logic + state tối thiểu + events | **BE logic + event nén** | User chốt: tối ưu byte/chi phí; BE đã có ladder verified | Audit trail on-chain ít hơn (chấp nhận v1) |
| D6 | Treasury custody | System-owned PDA (escrow pattern) / program-owned + lamport mutation | **System-owned PDA** | Standard, không cần rent-exempt games, audit rõ | +1 CPI mỗi lần chuyển |
| D7 | Marks oracle | Pyth/oracle on-chain / keeper push | **Keeper push + freshness + delta cap** | Memecoin không có oracle; BE đã có pricing | Trust keeper — bound bằng caps + audit gate |
| D8 | Jupiter | Direct tx từ BE hot wallet / CPI từ program | **CPI từ program (gated)** | Treasury authority vẫn là program; non-custodial | Route size (ALT), cần mock-test kỹ |
| D9 | Integration | Rewrite / dual-mode opt-in | **Dual-mode theo Vault row + flags mới** | Không gãy demo/regression | Hai nguồn sự thật tạm thời (chain + DB mirror) |
| D10 | Guard rút tiền | không guard / `min_payout` | **`min_payout` (patch v1.1)** | Chống trôi giá + keeper hạ marks giữa estimate→execute; đối xứng `min_out` | User phải ký lại khi revert |
| D11 | Trần nghĩa vụ sim | không / `max_marks_bps` | **`max_marks_bps` policy (patch v1.1)** | Lãi mô phỏng rút được bị bound theo cash thật (funding policy §7.5) | Siết demo khi marks chạm trần |
| D12 | Đối chiếu số liệu | tin BE / 3 tầng + parity + reconcile job | **3 tầng A/B/C + parity + `chain-reconcile` (patch v1.1)** | Chứng minh số DB == chain; định nghĩa nguồn SOL trả lãi giả khi sim | Thêm vận hành (job + alert) |

## Solution Challenge (điểm đã cân nhắc & bác bỏ)

- **BE relay/zero-popup**: bác bỏ — burn/transfer SPL cần chữ ký owner; ép delegate/ledger nội
  bộ làm mất tính "user giữ share" và thêm allowance state; user cũng muốn thao tác trực quan.
- **Toàn bộ ladder on-chain**: bác bỏ đợt này — tốn thêm account/PDA (position per mint),
  byte budget lớn, logic đã verified ở BE; có thể nâng cấp sau cho mainnet enforcement.
- **Queue rút on-chain**: bác bỏ v1 — thêm ít nhất 2 PDA types + instruction; user chốt
  instant exact payout.
- **Program-owned treasury + lamport mutation**: bác bỏ — phải tự quản rent-exempt floor,
  dễ sai; escrow pattern system-owned an toàn hơn.

## System Design Gate

→ Chi tiết đầy đủ tại `docs/architecture/SOLANA_PROGRAM_DESIGN.md` (account model, PDA
seeds, instruction table, formulas, byte budget, CPI boundaries, failure modes, integration
BE/FE, testing, deployment/upgrade, trust model). Document này thay thế
`docs/architecture/VAULT_CONTRACT_DESIGN.md` (bản doc-only cũ).

## Bounded Specification (tóm tắt — full ở design doc)

- Accounts: `Vault` (PDA `[b"vault", name]`, zero-copy ~150B), `ShareMint` (`[b"shares", vault]`),
  `Treasury` (`[b"treasury", vault]`, system-owned), `VaultAuthority` (`[b"authority", vault]`),
  ATAs (WSOL + position tokens). Không position accounts / epoch accounts / queue accounts v1.
- Instructions v1: `initialize_vault`, `update_policy`, `set_paused`, `deposit`, `withdraw(shares, min_payout)`,
  `update_marks`, `settle_epoch`, `collect_fees`, `record_sim_trade`, `execute_swap` (gated).
- Policy: fee_bps, withdraw_fee_bps, reserve_bps, max_trade_bps, max_marks_bps (trần nghĩa vụ sim).
- BE: module `chain` (indexer + keeper + faucet + **reconcile job** + config), migration mới
  (chain columns + `chain_events`), pool detail thêm block `chain`.
- Events nén: VaultInit, Deposit, Withdraw, Mark, EpochSettled, SimTrade, SwapExecuted, Paused,
  FeesCollected.
- BE: module `chain` (indexer + keeper + faucet + config), migration mới (chain columns +
  `chain_events`), pool detail thêm block `chain`.
- FE: `lib/chain.ts` + IDL, deposit/withdraw modal cho chain pool = user-signed tx,
  badge devnet + explorer link + nút faucet.

## Task Breakdown (khung phase — repo-phase-orchestrator sẽ chốt)

- [ ] P0 Toolchain: cài Agave CLI, Anchor workspace, build xanh, IDL path, CI hooks
- [ ] P1 Program core + Rust/LiteSVM tests + deploy devnet
- [ ] P2 BE chain module: migration, indexer, keeper, faucet, config (approval protected files)
- [ ] P3 FE: chain client, user-signed deposit/withdraw, badges/faucet, e2e devnet demo
- [ ] P4 Mainnet Jupiter: execute_swap + mock-CPI tests + dry-run tool + runbook (flag OFF)
- [ ] P5 Hardening: fuzz, threat model, cost report, multisig/audit checklist

## Tests

- TDD mode: Rust unit tests cho math (u128 paths, rounding, bootstrap, fee) trước khi code ix.
- LiteSVM integration: happy + negative (paused, stale, min deposit, reserve floor, not-keeper,
  mark delta cap, fee over credit, insufficient liquidity, slippage).
- Mock Jupiter program (litesvm) cho CPI boundary; devnet e2e script (tsx) theo convention repo.
- Verification alternatives: parity test off-chain `assert-vault.ts` vs litesvm cùng scenario.

## QA Evidence

- Edge cases: supply=0 bootstrap; NAV âm → clamp/revert; rút toàn bộ khi flat; rút khi marks
  stale; deposit đúng lúc HWM; fee đúng bằng 0 khi không vượt đỉnh; pause escalation;
  tx size execute_swap với route lớn (fail-soft).
- Regression targets: toàn bộ assert suites BE hiện có; pool off-chain flows; typecheck FE/BE.
- Evidence gaps (chấp nhận): mainnet swap thật chưa chạy (gate OFF) — ghi rõ trong report.
- Acceptance verdict: chờ P1–P3 xong mới verdict; P4 verdict = dry-run + mock green.

## Selected Agent Cards

- Solution Challenger (đã dùng — D1..D9 đã qua why-this-not-that) ✔
- System Designer: design doc + boundary/integration — ✔ (bản này + SOLANA_PROGRAM_DESIGN.md)
- Senior QA: edge-case matrix + verdict sau P1–P3
- Verifier: litesvm + devnet e2e + parity evidence
- Implementer: native execution theo phase plan

## Required Evidence

- Intent contract (file này) · decision ledger (bảng D1–D9 + bảng trong design doc)
- Acceptance evidence theo từng phase (commands + outputs)
- Litesvm test report + devnet e2e log + dry-run mainnet log
- Regression: typecheck + assert suites xanh

## Implementation Handoff

Chuyển `repo-phase-orchestrator` sau khi user review xong design doc. Phase plan +
tracker đặt tại `docs/codexminimal/plans/2026-10-13-solana-vault-program-phase-plan.md` và
`docs/codexminimal/trackers/2026-10-13-solana-vault-program-tracker.md` (chưa tạo).

## Verification

```bash
# P1
anchor build && cargo test                 # (README: LiteSVM suites)
anchor deploy --provider.cluster devnet
npx tsx scripts/chain/devnet-e2e.ts       # deposit → marks → withdraw → asserts
# P2/P3
npm run typecheck && npx tsx src/modules/**/assert-*.ts
curl -s http://localhost:3000/api/vaults/:id/pool | jq .chain
# P4 (không gửi)
npx tsx scripts/chain/jupiter-dry-run.ts  # build tx từ quote thật, in base64
```

## Report

Sẽ điền sau khi các phase hoàn tất (P1–P5), kèm residual risks (trust keeper, mainnet chưa
chạy, upgrade authority đơn key trên devnet).

## Open Questions Or Assumptions

- ASSUMPTION: Agave CLI cài được trên máy này (phase 0); nếu không → chuyển sang GitHub Codespace/CI build.
- ASSUMPTION: Program keypair devnet do BE/ops giữ trong env (không commit); mainnet dùng multisig sau này.
- ASSUMPTION: Fee split 80/15/5 chi tiết giữ off-chain (DB); on-chain `collect_fees` chỉ về `fee_sink`.
- ASSUMPTION: Devnet faucet (airdrop) là cách cấp SOL demo cho user; rate-limit + genesis gate.
- OPEN: Tên chính thức program id prefix (devnet keypair) — chốt ở P0.
