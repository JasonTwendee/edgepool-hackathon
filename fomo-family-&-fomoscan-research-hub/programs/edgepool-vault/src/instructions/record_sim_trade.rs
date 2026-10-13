//! record_sim_trade — keeper ghi audit trade mô phỏng (devnet-only). Event thuần.
use anchor_lang::prelude::*;

use crate::errors::EdgepoolError;
use crate::events::SimTradeEvent;
use crate::state::Vault;

#[derive(Accounts)]
pub struct RecordSimTrade<'info> {
    #[account(has_one = keeper)]
    pub vault: Box<Account<'info, Vault>>,
    pub keeper: Signer<'info>,
}

pub fn handler(
    ctx: Context<RecordSimTrade>,
    mint: Pubkey,
    side: u8,
    size_lamports: u64,
    price_scaled: u64,
    pnl_lamports: i64,
) -> Result<()> {
    let vault = &ctx.accounts.vault;
    // Sim records chỉ có nghĩa trên devnet/sandbox (mainnet dùng SwapExecuted thật).
    require!(vault.env == 0, EdgepoolError::EnvMismatch);

    emit!(SimTradeEvent {
        vault: vault.key(),
        mint,
        side,
        size_lamports,
        price_scaled,
        pnl_lamports,
    });
    Ok(())
}
