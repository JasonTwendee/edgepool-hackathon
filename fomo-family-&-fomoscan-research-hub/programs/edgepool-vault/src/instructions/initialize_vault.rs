//! initialize_vault — tạo Vault + ShareMint + Treasury + Authority (4 PDA).
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{Mint, Token};

use crate::errors::EdgepoolError;
use crate::events::VaultInit;
use crate::state::{Vault, BOOTSTRAP_PRICE_SCALED, INITIAL_TREASURY_FUND_LAMPORTS, MAX_NAME_LEN};

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub manager: Signer<'info>,

    #[account(
        init,
        payer = manager,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", name.as_bytes()],
        bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init,
        payer = manager,
        seeds = [b"shares", vault.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = vault_authority,
    )]
    pub share_mint: Box<Account<'info, Mint>>,

    /// System-owned PDA giữ SOL — escrow pattern; fund buffer tại init.
    #[account(
        mut,
        seeds = [b"treasury", vault.key().as_ref()],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// PDA signer thuần (mint authority + owner ATA) — không cần account data.
    /// CHECK: chỉ dùng key + seeds làm signer.
    #[account(seeds = [b"authority", vault.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
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
    require!(!name.is_empty() && name.len() <= MAX_NAME_LEN, EdgepoolError::NameTooLong);
    require!(
        fee_bps <= 10_000
            && withdraw_fee_bps <= 10_000
            && reserve_bps <= 10_000
            && max_trade_bps <= 10_000
            && max_marks_bps <= 10_000,
        EdgepoolError::InvalidParam
    );
    require!(env <= 1, EdgepoolError::InvalidParam);

    // Fund treasury: tạo system account + giữ buffer tối thiểu (manager trả).
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.manager.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        INITIAL_TREASURY_FUND_LAMPORTS,
    )?;

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;
    vault.manager = ctx.accounts.manager.key();
    vault.keeper = keeper;
    // v1: fee_sink = manager (BE ops) — split 80/15/5 chạy off-chain (design §7).
    vault.fee_sink = ctx.accounts.manager.key();
    vault.total_shares = 0;
    vault.hwm_price = BOOTSTRAP_PRICE_SCALED;
    vault.marks_lamports = 0;
    vault.marks_slot = clock.slot;
    vault.fee_credit = 0;
    vault.epoch = 0;
    vault.fee_bps = fee_bps;
    vault.withdraw_fee_bps = withdraw_fee_bps;
    vault.reserve_bps = reserve_bps;
    vault.max_trade_bps = max_trade_bps;
    vault.max_marks_bps = max_marks_bps;
    vault.flags = 0;
    vault.env = env;
    vault.bump = ctx.bumps.vault;

    emit!(VaultInit {
        vault: vault.key(),
        manager: vault.manager,
        keeper,
        fee_bps,
        env,
        name,
    });
    Ok(())
}
