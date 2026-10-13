//! set_paused — kill-switch: chặn deposit (và swap sau này). Withdraw không bị chặn.
use anchor_lang::prelude::*;

use crate::events::PausedEvent;
use crate::state::{Vault, FLAG_PAUSED};

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, has_one = manager)]
    pub vault: Box<Account<'info, Vault>>,
    pub manager: Signer<'info>,
}

pub fn handler(ctx: Context<SetPaused>, flag: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    if flag {
        vault.flags |= FLAG_PAUSED;
    } else {
        vault.flags &= !FLAG_PAUSED;
    }
    emit!(PausedEvent {
        vault: vault.key(),
        flag,
    });
    Ok(())
}
