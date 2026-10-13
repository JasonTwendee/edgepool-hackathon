# edgepool-vault — Solana program

SOL custody + vSHARE accounting on-chain. **Devnet-first**, Jupiter mainnet path gated (P4).
Thiết kế đầy đủ: `docs/architecture/SOLANA_PROGRAM_DESIGN.md` (v1.1) · tracker: `docs/codexminimal/trackers/2026-10-13-solana-vault-program-tracker.md`.

- **Program ID (devnet):** `5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ` (slot 510,563,107)
- **Trạng thái:** P1 done — 9 instructions, 26/26 tests, e2e devnet PASS
- **Build:** `bash ../../scripts/program-build.sh` (SBF **arch v2** — bắt buộc cho LiteSVM; script đã gồm IDL)

## TL;DR mental model (đọc trước, 2 phút)

```
User ký deposit/withdraw ──▶ Program (giữ luật + tiền)  ◀── Keeper ký marks/settle
                                  │
      4 PDA: vault · share-mint · treasury (giữ SOL) · authority     Manager: policy/pause/collect
                                  │
      NAV = treasury + marks − fee_credit      giá = NAV / tổng shares
```

- **Program không giữ keypair** — mọi quyền là PDA seeds + role (keeper/manager).
- **Tiền chỉ rời treasury** khi: user burn shares (withdraw) hoặc collect fee (≤ fee_credit).
- **Withdraw không bao giờ bị chặn** (kể cả pause) — thoát vốn là quyền tối thượng.
- Ladder tín hiệu/TP-SL vẫn ở BE (đã verified); program chỉ nhận **marks** (giá trị positions) + event audit.

## Lộ trình đọc hiểu (theo thứ tự)

### Bước 1 — Bối cảnh & luật chơi (~30')
Đọc `docs/architecture/SOLANA_PROGRAM_DESIGN.md` **§1–§5 + §7.5**:
mục tiêu, account model (bảng PDA), instruction table, công thức NAV/phí, bridge sim↔chain.
Sau bước này bạn hiểu "tại sao" trước khi đọc "làm sao".

### Bước 2 — State & toán (đọc code + chạy tests) (~45')
| File | Học được gì |
|---|---|
| `src/state.rs` | `Vault` struct (~165B) — từng field một; các const (MIN_DEPOSIT, MAX_STALE_SLOTS, caps) |
| `src/math.rs` | Toàn bộ số học u128: NAV, giá, mint/payout (floor), phí HWM, touch-settle |

**Chạy:** `cargo test -p edgepool-vault --lib` — 12 unit tests trong `math.rs` **chính là tài liệu** (có ví dụ số tính tay: pool 10 SOL/4 shares, phí 0.08 SOL…).

### Bước 3 — Instructions theo đúng hành trình user (~60')
Đọc theo thứ tự này (mỗi file 2 phần: `#[derive(Accounts)]` = cổng kiểm tra, `handler` = logic):

| # | File | Câu chuyện |
|---|---|---|
| 1 | `src/instructions/initialize_vault.rs` | Tạo 4 PDA; treasury buffer; keeper/manager đầu tiên |
| 2 | `src/instructions/deposit.rs` | touch-settle → giá chốt **trước khi tiền vào** → mint vSHARE |
| 3 | `src/instructions/update_marks.rs` | Keeper role, delta cap 20%/lần, trần marks |
| 4 | `src/instructions/withdraw.rs` | payout + `min_payout` guard + reserve floor + cash check |
| 5 | `src/instructions/settle_epoch.rs` | Chốt epoch, phí accrual, HWM ratchet |
| 6 | `src/instructions/collect_fees.rs` | Manager thu phí ≤ fee_credit về fee_sink |
| 7 | `src/instructions/set_paused.rs` + `update_policy.rs` | Admin |
| 8 | `src/instructions/record_sim_trade.rs` | Audit trade mô phỏng (devnet-only) |

`src/lib.rs` = danh mục 9 instruction (đọc như mục lục) · `src/errors.rs` · `src/events.rs` = từ điển lỗi/event.

### Bước 4 — Tests đọc như đặc tả (~45')
| File | Nội dung |
|---|---|
| `tests/lifecycle.rs` | Happy path với số tính tay: bootstrap 1:1, giá theo NAV, phí HWM, min_payout boundary, pause, staleness |
| `tests/gates.rs` | **Các "luật cứng" dễ hiểu nhất**: min deposit, delta cap, marks cap, thiếu cash, reserve floor, roles, env gate |
| `tests/common/mod.rs` | Harness LiteSVM: cách build instruction bằng tay + assert error code |

**Chạy riêng từng suite:** `cargo test -p edgepool-vault --test gates`

### Bước 5 — Chạy thật trên devnet (~15')
```bash
cd backend && npx tsx scripts/chain/devnet-e2e.ts
```
Script chạy **7 bước thật** (init → deposit → marks → settle → withdraw → sim_trade → collect) và in link explorer cho từng account — mở explorer đối chiếu số.

### Bước 6 — Tự tay tương tác (tùy chọn)
- `idls/edgepool_vault.json` = interface chuẩn (đọc để thấy args/accounts từng ix).
- Copy `backend/scripts/chain/devnet-e2e.ts` làm mẫu viết script riêng (đổi số, thử lỗi cố ý).

## Câu hỏi tự kiểm tra (trả lời được = đã hiểu)

1. Vì sao giá được chốt **trước** khi tiền deposit chuyển vào treasury?
2. Touch-settle chạy ở những instruction nào, và vì sao phải chạy **trước** khi tính payout?
3. `min_payout` bảo vệ user khỏi 3 kịch bản nào (§5.4 design doc)?
4. Vì sao deposit bị chặn khi pause nhưng withdraw thì không?
5. Delta cap (20%/lần) vs trần `max_marks_bps` — khác nhau thế nào, cần cả hai để làm gì?
6. Phí hiệu suất chỉ thu trên phần nào? HWM "ratchet" nghĩa là gì?
7. Khi nào treasury hết cash và chuyện gì xảy ra (v1)?
8. Vì sao `record_sim_trade` từ chối khi `env = 1` (mainnet)?

## Map sang hệ thống off-chain (để nối não)

| Off-chain (đã chạy) | On-chain P1 |
|---|---|
| `vault.service.ts` deposit + `settleEpoch` auto-MTM | `deposit` / `withdraw` instant tại giá hiện tại |
| NAV engine (DataStream marks) | `update_marks` (keeper) |
| HWM fee + `bookFeeSplit` 80/15/5 | `fee_credit` + `collect_fees` (split giữ off-chain) |
| `manage.service` ladder TP1/TP2/stop/trail | BE giữ nguyên; ghi `record_sim_trade` làm audit |

## Ghi chú vận hành

- **Không dùng `.eqn(số > 2^26)` với BN của anchor** (bug bn.js) — dùng `.eq(new BN(x))`.
- Build phải qua `scripts/program-build.sh` (arch v2 + copy IDL) — `anchor build` trần sẽ ra v3 và test LiteSVM không load được.
- Keypair program: backup tại `~/.config/solana/edgepool_vault-keypair.json` — **không bao giờ xóa** (mất = mất quyền upgrade).
- Fixtures `tests/fixtures/*.so` dump từ devnet (override built-in token 3.5.0 thiếu `InitializeMint2`).
