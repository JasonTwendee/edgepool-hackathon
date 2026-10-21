//! update_policy — manager đổi tham số policy (bps). Không đổi env/manager/keeper.
use anchor_lang::prelude::*;

use crate::errors::EdgepoolError;
use crate::state::Vault;

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(mut, has_one = manager)]
    pub vault: Box<Account<'info, Vault>>,
    pub manager: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdatePolicy>,
    fee_bps: u16,
    withdraw_fee_bps: u16,
    reserve_bps: u16,
    max_trade_bps: u16,
    max_marks_bps: u16,
) -> Result<()> {
    require!(
        fee_bps <= 10_000
            && withdraw_fee_bps <= 10_000
            && reserve_bps <= 10_000
            && max_trade_bps <= 10_000
            && max_marks_bps <= 10_000,
        EdgepoolError::InvalidParam
    );
    let vault = &mut ctx.accounts.vault;
    vault.fee_bps = fee_bps;
    vault.withdraw_fee_bps = withdraw_fee_bps;
    vault.reserve_bps = reserve_bps;
    vault.max_trade_bps = max_trade_bps;
    vault.max_marks_bps = max_marks_bps;
    Ok(())
}
