//! Error codes — tên khớp design §5 và FE error mapping.
use anchor_lang::prelude::*;

#[error_code]
pub enum EdgepoolError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Signer is not the keeper")]
    NotKeeper,
    #[msg("Signer is not the manager")]
    NotManager,
    #[msg("Marks are stale — keeper must refresh")]
    StaleMarks,
    #[msg("Marks exceed the policy cap vs treasury cash")]
    MarksCapExceeded,
    #[msg("Marks move exceeds the per-update delta cap")]
    MarksDeltaExceeded,
    #[msg("Deposit is below the 0.5 SOL minimum")]
    DepositTooSmall,
    #[msg("User does not hold enough shares")]
    InsufficientShares,
    #[msg("Insufficient treasury liquidity for this payout")]
    InsufficientLiquidity,
    #[msg("Withdrawal would breach the reserve floor")]
    ReserveFloorBreached,
    #[msg("NAV is invalid for this operation")]
    NavInvalid,
    #[msg("Payout is below min_payout")]
    PayoutBelowMin,
    #[msg("Instruction is not allowed in this environment")]
    EnvMismatch,
    #[msg("Trade size exceeds the per-trade cap")]
    TradeTooLarge,
    #[msg("Swap output is below min_out")]
    SlippageExceeded,
    #[msg("Amount exceeds accrued fee credit")]
    FeeExceedsCredit,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Name is empty or too long (max 24 bytes)")]
    NameTooLong,
    #[msg("Invalid parameter")]
    InvalidParam,
}
