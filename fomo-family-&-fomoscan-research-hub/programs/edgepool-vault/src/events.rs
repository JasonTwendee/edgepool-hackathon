//! Compact on-chain events — audit trail (design §6). Không thêm field thừa.
use anchor_lang::prelude::*;

#[event]
pub struct VaultInit {
    pub vault: Pubkey,
    pub manager: Pubkey,
    pub keeper: Pubkey,
    pub fee_bps: u16,
    pub env: u8,
    pub name: String,
}

#[event]
pub struct DepositEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub amount_lamports: u64,
    pub minted_raw: u64,
    pub price_scaled: u64,
}

#[event]
pub struct WithdrawEvent {
    pub vault: Pubkey,
    pub user: Pubkey,
    pub shares_raw: u64,
    pub paid_lamports: u64,
    pub fee_lamports: u64,
    pub price_scaled: u64,
}

#[event]
pub struct MarkEvent {
    pub vault: Pubkey,
    pub marks_lamports: u64,
    pub slot: u64,
}

#[event]
pub struct EpochSettled {
    pub vault: Pubkey,
    pub epoch: u64,
    pub nav_lamports: u64,
    pub price_scaled: u64,
    pub total_shares: u64,
    pub fee_credit: u64,
}

#[event]
pub struct SimTradeEvent {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub side: u8,
    pub size_lamports: u64,
    pub price_scaled: u64,
    pub pnl_lamports: i64,
}

#[event]
pub struct PausedEvent {
    pub vault: Pubkey,
    pub flag: bool,
}

#[event]
pub struct FeesCollected {
    pub vault: Pubkey,
    pub amount_lamports: u64,
    pub fee_sink: Pubkey,
}
