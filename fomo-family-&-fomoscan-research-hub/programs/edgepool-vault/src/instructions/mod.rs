// Re-export để `#[program]` macro (sinh `pub mod accounts` với path `crate::__client_accounts_*`)
// resolve được — pattern chuẩn multi-file của Anchor.
// `handler` xuất hiện ở mọi module → glob trùng tên là chủ đích (luôn gọi qualified).
#![allow(ambiguous_glob_reexports)]

pub mod collect_fees;
pub mod deposit;
pub mod initialize_vault;
pub mod record_sim_trade;
pub mod set_paused;
pub mod settle_epoch;
pub mod update_marks;
pub mod update_policy;
pub mod withdraw;

pub use collect_fees::*;
pub use deposit::*;
pub use initialize_vault::*;
pub use record_sim_trade::*;
pub use set_paused::*;
pub use settle_epoch::*;
pub use update_marks::*;
pub use update_policy::*;
pub use withdraw::*;
