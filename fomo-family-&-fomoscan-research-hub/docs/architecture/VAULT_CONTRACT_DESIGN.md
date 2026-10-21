# Vault Contract — thiết kế (chưa implement) — ⚠️ SUPERSEDED

> **Bản này đã được thay thế bởi `docs/architecture/SOLANA_PROGRAM_DESIGN.md` (2026-10-13)**
> — thiết kế đầy đủ theo chuẩn Solana program (account model byte-optimized, instruction
> spec, CPI boundaries, integration dual-mode, testing, phases). Giữ file này làm lịch sử.

Mục tiêu: đưa kế toán MoneyFi (Phase C off-chain, đã live) lên on-chain Solana
khi team sẵn sàng. Tài liệu thiết kế, KHÔNG phải code.

## 1. Lựa chọn kiến trúc

- **Anchor program** riêng (không dùng protocol có sẵn): toàn quyền fee/HWM/epoch,
  khớp BE hiện tại. SPL Token thường làm **vault share mint** (decimals 9),
  user giữ share như token — rút = burn share + nhận SOL theo giá settle.
- Authority: vault PDA (`seeds = ["vault", name]`), share mint PDA
  (`["shares", vault]`), treasury PDA (`["treasury", vault]`).
- Upgrade authority: multisig team (devnet: 1 key) — ghi rõ, không giấu.

## 2. Accounts

| Account | Seeds | Chứa |
|---|---|---|
| `Vault` | `["vault", name]` | manager, share_mint, treasury, nav_lamports (cache), shares_supply, hwm_price, fee_bps, epoch, paused |
| Share mint | `["shares", vault]` | SPL mint, authority = vault PDA |
| Treasury | `["treasury", vault]` | SOL/system account, owner = vault PDA |
| `Epoch` (PDA/counter) | `["epoch", vault, id]` | nav, price, shares, fee, settled_at |

## 3. Instructions

| Ix | Ai gọi | Làm gì |
|---|---|---|
| `initialize(name, fee_bps)` | manager | Tạo vault/mint/treasury PDA |
| `deposit(amount)` | user | Chuyển SOL → treasury, ghi **pending** (không mint ngay) |
| `settle_epoch(nav)` | keeper/bot | Tính price = (nav − pending_in)/supply; mint share cho deposits; burn + payout withdrawals; fee nếu vượt HWM; đóng epoch. Fail-closed khi oracle cũ |
| `execute_copy(...)` | keeper (sau này) | Bắn swap từ treasury theo tín hiệu (Jupiter CPI hoặc Phoenix), chỉ khi vault unpaused |
| `pause/unpause` | manager/guardian | Kill-switch on-chain (ngày −5%, tuần −15%) |
| `collect_fees` | manager | Rút fee về ví team theo split 80/15/5 (off-chain split trước, sau này SPL ref) |

## 4. Ràng buộc từ MoneyFi (bắt buộc giữ)

- Mint/burn **chỉ ở settle**, đúng giá settle; nạp/rút giữa epoch là queued.
- Giá trừ pending deposits (chống tự thổi giá) — đã chứng minh bằng assert off-chain.
- HWM/share chỉ tăng, fee chỉ trên lãi mới; `fee_bps = 0` = tắt (MoneyFi thuần).
- Không chia lãi từng lệnh — quyền lợi qua share.

## 5. Rủi ro & kiểm soát

- Oracle NAV: keeper đẩy nav + slot; contract từ chối nav cũ hơn N slot.
- Pause escalation: guardian (bot) pause được, chỉ manager unpause.
- Audit trước mainnet (ít nhất 1 review ngoài + test suite Anchor + fuzz số học
  Decimal overflow/underflow, chia 0 khi supply = 0).
- Devnet trước: deploy devnet, chạy song song off-chain 2 tuần, so khớp từng epoch.

## 6. Lộ trình

1. Phase C off-chain (XONG): BE + DB, logic đã verify bằng asserts + E2E live.
2. Anchor skeleton + test local (solana-test-validator).
3. Devnet deploy + song song đối chiếu.
4. Audit + mainnet (khi có quyết định vốn thật).
