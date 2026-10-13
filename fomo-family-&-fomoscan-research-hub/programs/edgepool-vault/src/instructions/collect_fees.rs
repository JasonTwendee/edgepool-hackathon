//! collect_fees — manager thu phí đã accrual (≤ fee_credit) về fee_sink.
use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::EdgepoolError;
use crate::events::FeesCollected;
use crate::state::Vault;

#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(mut, has_one = manager)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(mut, seeds = [b"treasury", vault.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    /// CHECK: nhận fee — constraint address = vault.fee_sink.
    #[account(mut, address = vault.fee_sink)]
    pub fee_sink: SystemAccount<'info>,

    pub manager: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CollectFees>, amount_lamports: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(amount_lamports > 0, EdgepoolError::InvalidParam);
    require!(amount_lamports <= vault.fee_credit, EdgepoolError::FeeExceedsCredit);
    require!(
        ctx.accounts.treasury.lamports() >= amount_lamports,
        EdgepoolError::InsufficientLiquidity
    );

    let vault_key = vault.key();
    let bump = [ctx.bumps.treasury];
    let signer_seeds: &[&[u8]] = &[b"treasury", vault_key.as_ref(), &bump];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.fee_sink.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount_lamports,
    )?;

    vault.fee_credit = vault
        .fee_credit
        .checked_sub(amount_lamports)
        .ok_or(EdgepoolError::MathOverflow)?;

    emit!(FeesCollected {
        vault: vault_key,
        amount_lamports,
        fee_sink: vault.fee_sink,
    });
    Ok(())
}
