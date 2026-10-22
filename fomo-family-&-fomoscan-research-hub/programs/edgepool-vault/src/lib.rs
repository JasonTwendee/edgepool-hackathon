//! Edgepool Vault — SOL custody + vSHARE accounting on Solana.
//!
//! Nguồn thiết kế: `docs/architecture/SOLANA_PROGRAM_DESIGN.md` (v1.1).
//! P1: instruction set 1–9 (initialize → record_sim_trade). `execute_swap` (P4) chưa có.
use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ");

#[program]
pub mod edgepool_vault {
    use super::*;

    /// Tạo vault: 4 PDA (vault/shares/treasury/authority) + fund treasury buffer.
    /// `env`: 0 = devnet/sandbox, 1 = mainnet/production (bất biến sau init).
    #[allow(clippy::too_many_arguments)]
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        name: String,
        keeper: Pubkey,
        fee_bps: u16,
        withdraw_fee_bps: u16,
        reserve_bps: u16,
        max_trade_bps: u16,
        max_marks_bps: u16,
        env: u8,
    ) -> Result<()> {
        initialize_vault::handler(
            ctx,
            name,
            keeper,
            fee_bps,
            withdraw_fee_bps,
            reserve_bps,
            max_trade_bps,
            max_marks_bps,
            env,
        )
    }

    /// Manager đổi policy (bps). Không đổi được env/manager/keeper.
    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        fee_bps: u16,
        withdraw_fee_bps: u16,
        reserve_bps: u16,
        max_trade_bps: u16,
        max_marks_bps: u16,
    ) -> Result<()> {
        update_policy::handler(
            ctx,
            fee_bps,
            withdraw_fee_bps,
            reserve_bps,
            max_trade_bps,
            max_marks_bps,
        )
    }

    /// Kill-switch: chặn deposit (+ swap sau này). KHÔNG chặn withdraw.
    pub fn set_paused(ctx: Context<SetPaused>, flag: bool) -> Result<()> {
        set_paused::handler(ctx, flag)
    }

    /// User nạp SOL → mint vSHARE tại giá hiện tại. Min 0.5 SOL.
    pub fn deposit(ctx: Context<Deposit>, amount_lamports: u64, operation_id: u64) -> Result<()> {
        deposit::handler(ctx, amount_lamports, operation_id)
    }

    /// User rút: burn vSHARE → nhận SOL tại giá hiện tại, `min_payout` là slippage guard.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        shares_raw: u64,
        min_payout_lamports: u64,
        operation_id: u64,
    ) -> Result<()> {
        withdraw::handler(ctx, shares_raw, min_payout_lamports, operation_id)
    }

    /// Keeper đẩy giá trị positions (marks) + freshness slot. Delta cap + trần policy.
    pub fn update_marks(ctx: Context<UpdateMarks>, marks_lamports: u64) -> Result<()> {
        update_marks::handler(ctx, marks_lamports)
    }

    /// Keeper settle phí hiệu suất (touch-settle) + tăng epoch counter + event.
    pub fn settle_epoch(ctx: Context<SettleEpoch>) -> Result<()> {
        settle_epoch::handler(ctx)
    }

    /// Manager thu phí đã accrual (≤ fee_credit) về fee_sink.
    pub fn collect_fees(ctx: Context<CollectFees>, amount_lamports: u64) -> Result<()> {
        collect_fees::handler(ctx, amount_lamports)
    }

    /// Keeper ghi nhận trade mô phỏng (devnet-only) — event thuần, không state change.
    pub fn record_sim_trade(
        ctx: Context<RecordSimTrade>,
        mint: Pubkey,
        side: u8,
        size_lamports: u64,
        price_scaled: u64,
        pnl_lamports: i64,
    ) -> Result<()> {
        record_sim_trade::handler(ctx, mint, side, size_lamports, price_scaled, pnl_lamports)
    }
}
