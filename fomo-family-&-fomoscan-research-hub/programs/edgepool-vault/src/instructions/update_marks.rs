//! update_marks — keeper đẩy giá trị positions (design §5.2): role + delta cap + trần policy.
use anchor_lang::prelude::*;

use crate::errors::EdgepoolError;
use crate::events::MarkEvent;
use crate::math;
use crate::state::{Vault, BPS_DENOM, MAX_MARK_DELTA_BPS};

#[derive(Accounts)]
pub struct UpdateMarks<'info> {
    #[account(mut, has_one = keeper)]
    pub vault: Box<Account<'info, Vault>>,

    /// CHECK: chỉ đọc lamports (cash) để tính NAV.
    #[account(seeds = [b"treasury", vault.key().as_ref()], bump)]
    pub treasury: UncheckedAccount<'info>,

    pub keeper: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateMarks>, marks_lamports: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    let cash = ctx.accounts.treasury.lamports();

    // Delta cap so với NAV cũ (nav = 0 → chỉ cho phép marks = 0).
    let nav_old = math::nav_lamports(cash, vault.marks_lamports, vault.fee_credit)?;
    let diff = if marks_lamports > vault.marks_lamports {
        (marks_lamports - vault.marks_lamports) as u128
    } else {
        (vault.marks_lamports - marks_lamports) as u128
    };
    let delta_cap = (nav_old as u128)
        .checked_mul(MAX_MARK_DELTA_BPS)
        .ok_or(EdgepoolError::MathOverflow)?
        / BPS_DENOM;
    require!(diff <= delta_cap, EdgepoolError::MarksDeltaExceeded);

    // Trần nghĩa vụ sim: marks ≤ cash * max_marks_bps (0 = tắt).
    if vault.max_marks_bps > 0 {
        let marks_cap = (cash as u128).checked_mul(vault.max_marks_bps as u128).ok_or(EdgepoolError::MathOverflow)?
            / BPS_DENOM;
        require!((marks_lamports as u128) <= marks_cap, EdgepoolError::MarksCapExceeded);
    }

    vault.marks_lamports = marks_lamports;
    vault.marks_slot = clock.slot;

    emit!(MarkEvent {
        vault: vault.key(),
        marks_lamports,
        slot: clock.slot,
    });
    Ok(())
}
