//! deposit — user nạp SOL, mint vSHARE tại giá hiện tại (touch-settle trước).
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::errors::EdgepoolError;
use crate::events::DepositEvent;
use crate::math;
use crate::state::{Vault, MAX_STALE_SLOTS, MIN_DEPOSIT_LAMPORTS};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(mut, seeds = [b"treasury", vault.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, seeds = [b"shares", vault.key().as_ref()], bump)]
    pub share_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA signer (mint authority).
    #[account(seeds = [b"authority", vault.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
    )]
    pub user_share_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount_lamports: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(!vault.is_paused(), EdgepoolError::VaultPaused);
    require!(amount_lamports >= MIN_DEPOSIT_LAMPORTS, EdgepoolError::DepositTooSmall);

    let clock = Clock::get()?;
    require!(
        vault.marks_lamports == 0
            || clock.slot.saturating_sub(vault.marks_slot) <= MAX_STALE_SLOTS,
        EdgepoolError::StaleMarks
    );

    // Giá chốt TRƯỚC khi tiền vào treasury (cash_pre).
    let cash_pre = ctx.accounts.treasury.lamports();
    let price = math::touch_settle(vault, cash_pre)?;
    let nav_pre = math::nav_lamports(cash_pre, vault.marks_lamports, vault.fee_credit)?;
    let minted = math::mint_for_deposit(amount_lamports, vault.total_shares, nav_pre)?;
    require!(minted > 0, EdgepoolError::DepositTooSmall);

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        amount_lamports,
    )?;

    let vault_key = vault.key();
    let bump = [ctx.bumps.vault_authority];
    let signer_seeds: &[&[u8]] = &[b"authority", vault_key.as_ref(), &bump];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_share_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        minted,
    )?;

    vault.total_shares = vault
        .total_shares
        .checked_add(minted)
        .ok_or(EdgepoolError::MathOverflow)?;

    emit!(DepositEvent {
        vault: vault_key,
        user: ctx.accounts.user.key(),
        amount_lamports,
        minted_raw: minted,
        price_scaled: price,
    });
    Ok(())
}
