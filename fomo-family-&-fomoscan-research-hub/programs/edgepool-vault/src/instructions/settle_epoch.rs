//! settle_epoch — keeper chốt epoch: touch-settle phí + tăng counter + event.
use anchor_lang::prelude::*;

use crate::errors::EdgepoolError;
use crate::events::EpochSettled;
use crate::math;
use crate::state::Vault;

#[derive(Accounts)]
pub struct SettleEpoch<'info> {
    #[account(mut, has_one = keeper)]
    pub vault: Box<Account<'info, Vault>>,

    /// CHECK: chỉ đọc lamports (cash) để tính NAV.
    #[account(seeds = [b"treasury", vault.key().as_ref()], bump)]
    pub treasury: UncheckedAccount<'info>,

    pub keeper: Signer<'info>,
}

pub fn handler(ctx: Context<SettleEpoch>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let cash = ctx.accounts.treasury.lamports();
    let price = math::touch_settle(vault, cash)?;
    let nav = math::nav_lamports(cash, vault.marks_lamports, vault.fee_credit)?;

    vault.epoch = vault.epoch.checked_add(1).ok_or(EdgepoolError::MathOverflow)?;

    emit!(EpochSettled {
        vault: vault.key(),
        epoch: vault.epoch,
        nav_lamports: nav,
        price_scaled: price,
        total_shares: vault.total_shares,
        fee_credit: vault.fee_credit,
    });
    Ok(())
}
