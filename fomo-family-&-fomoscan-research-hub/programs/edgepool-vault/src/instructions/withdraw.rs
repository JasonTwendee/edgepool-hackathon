//! withdraw — user burn vSHARE, nhận SOL tại giá hiện tại.
//! `min_payout_lamports` = slippage guard (design §5.4): paid < min → revert.
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};

use crate::errors::EdgepoolError;
use crate::events::WithdrawEvent;
use crate::math;
use crate::state::{OperationReceipt, Vault, MAX_STALE_SLOTS, MIN_TREASURY_BUFFER_LAMPORTS};

#[derive(Accounts)]
#[instruction(shares_raw: u64, min_payout_lamports: u64, operation_id: u64)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(mut, seeds = [b"treasury", vault.key().as_ref()], bump)]
    pub treasury: SystemAccount<'info>,

    #[account(mut, seeds = [b"shares", vault.key().as_ref()], bump)]
    pub share_mint: Box<Account<'info, Mint>>,

    /// CHECK: PDA signer — không dùng account data.
    #[account(seeds = [b"authority", vault.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// Idempotency receipt; duplicate (vault,user,operation_id) fails at init.
    #[account(
        init,
        payer = user,
        space = 8,
        seeds = [b"operation".as_ref(), &[1u8][..], vault.key().as_ref(), user.key().as_ref(), &operation_id.to_le_bytes()],
        bump
    )]
    pub operation: Account<'info, OperationReceipt>,

    #[account(mut, token::mint = share_mint, token::authority = user)]
    pub user_share_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Withdraw>,
    shares_raw: u64,
    min_payout_lamports: u64,
    operation_id: u64,
) -> Result<()> {
    let _ = operation_id;
    let vault = &mut ctx.accounts.vault;
    require!(shares_raw > 0, EdgepoolError::InvalidParam);
    require!(
        ctx.accounts.user_share_ata.amount >= shares_raw,
        EdgepoolError::InsufficientShares
    );

    let clock = Clock::get()?;
    require!(
        vault.marks_lamports == 0 || clock.slot.saturating_sub(vault.marks_slot) <= MAX_STALE_SLOTS,
        EdgepoolError::StaleMarks
    );

    // Touch-settle trước khi trả tiền — phí chỉ trên lãi mới.
    let cash = ctx.accounts.treasury.lamports();
    let price = math::touch_settle(vault, cash)?;
    let nav = math::nav_lamports(cash, vault.marks_lamports, vault.fee_credit)?;

    let payout = math::payout_for(shares_raw, nav, vault.total_shares)?;
    let fee = math::bps_of(payout, vault.withdraw_fee_bps)?;
    let paid = payout.checked_sub(fee).ok_or(EdgepoolError::MathOverflow)?;

    // Slippage guard: người ký chốt ngưỡng nhận tối thiểu.
    require!(paid >= min_payout_lamports, EdgepoolError::PayoutBelowMin);

    // Thanh khoản: đủ cash + giữ buffer + tôn trọng reserve floor.
    let leftover = cash
        .checked_sub(paid)
        .ok_or(EdgepoolError::InsufficientLiquidity)?;
    require!(
        leftover >= MIN_TREASURY_BUFFER_LAMPORTS,
        EdgepoolError::InsufficientLiquidity
    );
    if vault.reserve_bps > 0 {
        let floor = math::bps_of(nav, vault.reserve_bps)?;
        require!(leftover >= floor, EdgepoolError::ReserveFloorBreached);
    }

    // Burn shares của user (user ký là authority của ATA).
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_share_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        shares_raw,
    )?;

    // Treasury → user (PDA-signed system transfer).
    let vault_key = vault.key();
    let bump = [ctx.bumps.treasury];
    let signer_seeds: &[&[u8]] = &[b"treasury", vault_key.as_ref(), &bump];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            &[signer_seeds],
        ),
        paid,
    )?;

    vault.total_shares = vault
        .total_shares
        .checked_sub(shares_raw)
        .ok_or(EdgepoolError::MathOverflow)?;

    emit!(WithdrawEvent {
        vault: vault_key,
        user: ctx.accounts.user.key(),
        shares_raw,
        paid_lamports: paid,
        fee_lamports: fee,
        price_scaled: price,
    });
    Ok(())
}
