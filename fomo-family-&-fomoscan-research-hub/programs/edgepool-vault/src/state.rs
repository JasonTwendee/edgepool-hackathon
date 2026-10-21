//! Vault state + hằng số toàn cục.
//!
//! Lưu ý (divergence so với design §3.2 — cập nhật cùng commit):
//! - v1 dùng account Borsh chuẩn (fixed-size fields) thay vì zero-copy: cùng kích thước
//!   byte (mọi field đều fixed-size), zero-copy chỉ là tối ưu compute — hoãn tới P5 nếu cần.
//! - Thêm field `keeper` (32B) để tách role keeper khỏi manager (design §5 ghi signer K
//!   nhưng bảng state thiếu field — keeper set 1 lần lúc init, không đổi được ở v1).
use anchor_lang::prelude::*;

/// Deposit tối thiểu — khớp gate off-chain 0.5 SOL (EDGEPOOL_DOCS §5).
pub const MIN_DEPOSIT_LAMPORTS: u64 = 500_000_000;
/// Marks cũ hơn giá trị này (slot) bị coi là stale khi vault có positions.
pub const MAX_STALE_SLOTS: u64 = 750;
/// Delta cap mỗi lần đẩy marks: 20% NAV cũ.
pub const MAX_MARK_DELTA_BPS: u128 = 2_000;
/// Treasury luôn giữ tối thiểu buffer này sau mọi payout/fee.
pub const MIN_TREASURY_BUFFER_LAMPORTS: u64 = 10_000_000; // 0.01 SOL
/// Fund ban đầu cho treasury lúc init (manager trả) — tạo account + buffer.
pub const INITIAL_TREASURY_FUND_LAMPORTS: u64 = 10_000_000;
/// Max độ dài `name` trong seed PDA.
pub const MAX_NAME_LEN: usize = 24;
/// Scale giá: price_scaled = lamports * PRICE_SCALE / raw_shares.
pub const PRICE_SCALE: u128 = 1_000_000_000;
/// 1 share = 1e9 raw; bootstrap: 1 SOL (1e9 lamports) → 1 share (1e9 raw).
pub const BOOTSTRAP_PRICE_SCALED: u64 = 1_000_000_000;
/// Basis points denominator.
pub const BPS_DENOM: u128 = 10_000;

/// flag bit 0 trong `Vault.flags`.
pub const FLAG_PAUSED: u8 = 1 << 0;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Ops authority: update_policy / set_paused / collect_fees. (mainnet: multisig)
    pub manager: Pubkey,
    /// Role keeper: update_marks / settle_epoch / record_sim_trade (BE hot key).
    pub keeper: Pubkey,
    /// Ví nhận perf fee đã collect (team treasury).
    pub fee_sink: Pubkey,
    /// Mirror của mint supply (raw, 1 share = 1e9). Giữ đồng bộ trong mỗi mint/burn.
    pub total_shares: u64,
    /// Giá lamports/raw-share scale 1e9 — đỉnh cao nhất cho phí hiệu suất.
    pub hwm_price: u64,
    /// Giá trị positions do keeper đẩy (lamports). 0 = vault all-cash.
    pub marks_lamports: u64,
    /// Slot lúc đẩy marks (freshness — program tự lấy Clock).
    pub marks_slot: u64,
    /// Phí hiệu suất đã accrual, chưa collect (lamports).
    pub fee_credit: u64,
    /// Counter cho event EpochSettled.
    pub epoch: u64,
    /// Phí hiệu suất bps (2000 = 20%; 0 = tắt).
    pub fee_bps: u16,
    /// Phí rút bps giữ lại treasury (0 = tắt).
    pub withdraw_fee_bps: u16,
    /// Sàn thanh khoản bps của NAV — chặn payout làm NAV tụt dưới floor.
    pub reserve_bps: u16,
    /// Cap mỗi lệnh execute_swap theo NAV bps (P4).
    pub max_trade_bps: u16,
    /// Trần marks so với treasury cash bps (0 = tắt; sim devnet đặt > 0).
    pub max_marks_bps: u16,
    /// Bitfield: bit0 paused.
    pub flags: u8,
    /// 0 = devnet/sandbox, 1 = mainnet/production (BẤT BIẾN sau init).
    pub env: u8,
    /// Canonical bump của vault PDA.
    pub bump: u8,
}

impl Vault {
    pub fn is_paused(&self) -> bool {
        self.flags & FLAG_PAUSED != 0
    }
}
