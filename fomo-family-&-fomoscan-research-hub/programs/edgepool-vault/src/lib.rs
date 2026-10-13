//! Edgepool Vault — SOL custody + vSHARE accounting on Solana.
//!
//! Nguồn thiết kế: `docs/architecture/SOLANA_PROGRAM_DESIGN.md` (v1.1).
//! Trạng thái: P0 skeleton — chỉ `ping` để chứng minh pipeline build/deploy;
//! instruction set đầy đủ (initialize_vault/deposit/withdraw/…) vào ở P1.
use anchor_lang::prelude::*;

declare_id!("5zkeKsjTYLkx9QKPMRdGDXuPR6C5AkT8jYuKfE7es3CQ");

#[program]
pub mod edgepool_vault {
    use super::*;

    /// P0 skeleton — smoke instruction, sẽ bị thay ở P1.
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("edgepool_vault: ping");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}
