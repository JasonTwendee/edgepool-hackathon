//! Test harness chung — LiteSVM + helpers build/send instruction.
//!
//! Fixtures: `tests/fixtures/spl_token.so` + `spl_ata.so` dump từ devnet
//! (override built-in token 3.5.0 của LiteSVM — anchor-spl dùng `InitializeMint2`
//! mà bản built-in cũ không hỗ trợ). Fetch lại: `solana program dump <ID> <file> --url https://api.devnet.solana.com`.
#![allow(dead_code)]

use anchor_lang::prelude::borsh::BorshSerialize;
use litesvm::types::TransactionResult;
use litesvm::LiteSVM;
use solana_instruction::error::InstructionError;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use std::path::PathBuf;

// Re-export cho test files (dùng qua `use common::*`).
pub use solana_instruction::{AccountMeta, Instruction};
pub use solana_keypair::Keypair;
pub use solana_pubkey::{pubkey, Pubkey};
pub use solana_signer::Signer;

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const SYSTEM_PROGRAM_ID: Pubkey = pubkey!("11111111111111111111111111111111");

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const INITIAL_TREASURY_FUND: u64 = 10_000_000; // khớp state.rs
pub const MIN_DEPOSIT: u64 = 500_000_000;

pub fn program_id() -> Pubkey {
    edgepool_vault::id()
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn program_so() -> PathBuf {
    manifest_dir().join("../../target/deploy/edgepool_vault.so")
}

fn fixture(name: &str) -> PathBuf {
    manifest_dir().join("tests/fixtures").join(name)
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &program_id()).0
}

pub fn vault_pda(name: &str) -> Pubkey {
    pda(&[b"vault", name.as_bytes()])
}

pub fn share_mint_pda(vault: &Pubkey) -> Pubkey {
    pda(&[b"shares", vault.as_ref()])
}

pub fn treasury_pda(vault: &Pubkey) -> Pubkey {
    pda(&[b"treasury", vault.as_ref()])
}

pub fn authority_pda(vault: &Pubkey) -> Pubkey {
    pda(&[b"authority", vault.as_ref()])
}

pub fn user_ata(user: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[user.as_ref(), TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ATA_PROGRAM_ID,
    )
    .0
}

pub fn discriminator(name: &str) -> [u8; 8] {
    let hash = anchor_lang::solana_program::hash::hash(format!("global:{name}").as_bytes());
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash.to_bytes()[..8]);
    out
}

pub fn ix_data(name: &str, args: impl BorshSerialize) -> Vec<u8> {
    let mut data = discriminator(name).to_vec();
    args.serialize(&mut data).unwrap();
    data
}

/// Env test: svm + keys + địa chỉ PDA của một vault đã init.
pub struct Env {
    pub svm: LiteSVM,
    pub manager: Keypair,
    pub keeper: Keypair,
    pub user: Keypair,
    pub user2: Keypair,
    pub vault: Pubkey,
    pub share_mint: Pubkey,
    pub treasury: Pubkey,
    pub authority: Pubkey,
}

impl Env {
    /// Setup LiteSVM + airdrop + initialize vault.
    pub fn new(name: &str, fee_bps: u16, max_marks_bps: u16, env_flag: u8) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(program_id(), program_so())
            .expect("load program .so — chạy `anchor build` trước");
        svm.add_program_from_file(TOKEN_PROGRAM_ID, fixture("spl_token.so"))
            .expect("fixture spl_token.so");
        svm.add_program_from_file(ATA_PROGRAM_ID, fixture("spl_ata.so"))
            .expect("fixture spl_ata.so");

        let manager = Keypair::new();
        let keeper = Keypair::new();
        let user = Keypair::new();
        let user2 = Keypair::new();
        for kp in [&manager, &keeper, &user, &user2] {
            svm.airdrop(&kp.pubkey(), 100 * LAMPORTS_PER_SOL).unwrap();
        }

        let vault = vault_pda(name);
        let share_mint = share_mint_pda(&vault);
        let treasury = treasury_pda(&vault);
        let authority = authority_pda(&vault);

        let mut env = Env { svm, manager, keeper, user, user2, vault, share_mint, treasury, authority };
        let ix = ix_initialize(&env, name, fee_bps, max_marks_bps, env_flag);
        let res = send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]);
        assert!(res.is_ok(), "initialize failed: {:?}", res.err().map(|e| e.meta.pretty_logs()));
        env
    }

    pub fn ata_of(&self, user: &Keypair) -> Pubkey {
        user_ata(&user.pubkey(), &self.share_mint)
    }
}

pub fn send_tx(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: &[Instruction],
) -> TransactionResult {
    // Expire blockhash mỗi lần gửi: tx lặp lại (cùng ix/accounts) sẽ có signature khác,
    // tránh dedupe "AlreadyProcessed" của LiteSVM.
    svm.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), signers, svm.latest_blockhash());
    svm.send_transaction(tx)
}

// ---------- instruction builders ----------

pub fn ix_initialize(env: &Env, name: &str, fee_bps: u16, max_marks_bps: u16, env_flag: u8) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.manager.pubkey(), true),
            AccountMeta::new(env.vault, false),
            AccountMeta::new(env.share_mint, false),
            AccountMeta::new(env.treasury, false),
            AccountMeta::new_readonly(env.authority, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
        ],
        data: ix_data(
            "initialize_vault",
            (
                name.to_string(),
                env.keeper.pubkey(),
                fee_bps,
                0u16,      // withdraw_fee_bps
                0u16,      // reserve_bps
                200u16,    // max_trade_bps
                max_marks_bps,
                env_flag,
            ),
        ),
    }
}

pub fn ix_deposit(env: &Env, user: &Keypair, amount: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.vault, false),
            AccountMeta::new(env.treasury, false),
            AccountMeta::new(env.share_mint, false),
            AccountMeta::new_readonly(env.authority, false),
            AccountMeta::new(user.pubkey(), true),
            AccountMeta::new(user_ata(&user.pubkey(), &env.share_mint), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(ATA_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data: ix_data("deposit", (amount,)),
    }
}

pub fn ix_withdraw(env: &Env, user: &Keypair, shares: u64, min_payout: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.vault, false),
            AccountMeta::new(env.treasury, false),
            AccountMeta::new(env.share_mint, false),
            AccountMeta::new_readonly(env.authority, false),
            AccountMeta::new(user.pubkey(), true),
            AccountMeta::new(user_ata(&user.pubkey(), &env.share_mint), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data: ix_data("withdraw", (shares, min_payout)),
    }
}

pub fn ix_update_marks(env: &Env, keeper: &Keypair, marks: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.vault, false),
            AccountMeta::new_readonly(env.treasury, false),
            AccountMeta::new_readonly(keeper.pubkey(), true),
        ],
        data: ix_data("update_marks", (marks,)),
    }
}

pub fn ix_settle_epoch(env: &Env, keeper: &Keypair) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.vault, false),
            AccountMeta::new_readonly(env.treasury, false),
            AccountMeta::new_readonly(keeper.pubkey(), true),
        ],
        data: ix_data("settle_epoch", ()),
    }
}

pub fn ix_set_paused(env: &Env, manager: &Keypair, flag: bool) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.vault, false),
            AccountMeta::new_readonly(manager.pubkey(), true),
        ],
        data: ix_data("set_paused", (flag,)),
    }
}

pub fn ix_update_policy(env: &Env, manager: &Keypair, fee_bps: u16, reserve_bps: u16) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.vault, false),
            AccountMeta::new_readonly(manager.pubkey(), true),
        ],
        data: ix_data("update_policy", (fee_bps, 0u16, reserve_bps, 200u16, 5000u16)),
    }
}

pub fn ix_collect_fees(env: &Env, manager: &Keypair, amount: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(env.vault, false),
            AccountMeta::new(env.treasury, false),
            AccountMeta::new(env.manager.pubkey(), false),
            AccountMeta::new_readonly(manager.pubkey(), true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM_ID, false),
        ],
        data: ix_data("collect_fees", (amount,)),
    }
}

pub fn ix_record_sim_trade(env: &Env, keeper: &Keypair) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(env.vault, false),
            AccountMeta::new_readonly(keeper.pubkey(), true),
        ],
        data: ix_data("record_sim_trade", (Pubkey::new_unique(), 0u8, 1_000u64, 1_000u64, 10i64)),
    }
}

// ---------- state readers ----------

pub fn vault_state(env: &Env) -> edgepool_vault::state::Vault {
    use anchor_lang::AccountDeserialize;
    let acc = env.svm.get_account(&env.vault).expect("vault account");
    edgepool_vault::state::Vault::try_deserialize(&mut acc.data.as_slice()).expect("decode vault")
}

pub fn balance(svm: &LiteSVM, pk: &Pubkey) -> u64 {
    svm.get_account(pk).map(|a| a.lamports).unwrap_or(0)
}

/// Supply của mint (offset 36..44, layout SPL Token classic ổn định).
pub fn mint_supply(svm: &LiteSVM, mint: &Pubkey) -> u64 {
    let acc = svm.get_account(mint).expect("mint account");
    u64::from_le_bytes(acc.data[36..44].try_into().unwrap())
}

pub fn mint_decimals(svm: &LiteSVM, mint: &Pubkey) -> u8 {
    svm.get_account(mint).expect("mint account").data[44]
}

/// Amount của token account (offset 64..72).
pub fn token_amount(svm: &LiteSVM, ata: &Pubkey) -> u64 {
    let acc = svm.get_account(ata).expect("token account");
    u64::from_le_bytes(acc.data[64..72].try_into().unwrap())
}

// ---------- error asserts ----------

pub fn custom_code(res: &TransactionResult) -> Option<u32> {
    match res {
        Err(f) => match f.err {
            TransactionError::InstructionError(_, InstructionError::Custom(c)) => Some(c),
            _ => None,
        },
        Ok(_) => None,
    }
}

pub fn assert_ok(res: TransactionResult) {
    if let Err(f) = res {
        panic!("expected Ok, got {:?}\n{}", f.err, f.meta.pretty_logs());
    }
}

pub fn assert_err(res: TransactionResult, expected: u32) {
    match res {
        Ok(_) => panic!("expected err {expected}, got Ok"),
        Err(f) => {
            let code = match f.err {
                TransactionError::InstructionError(_, InstructionError::Custom(c)) => Some(c),
                _ => None,
            };
            assert_eq!(
                code,
                Some(expected),
                "expected err code {expected}, got {:?}\n{}",
                f.err,
                f.meta.pretty_logs()
            );
        }
    }
}

/// Code của lỗi program: `u32::from(variant)` = 6000 + index (anchor error_code).
pub fn ep_err(e: edgepool_vault::errors::EdgepoolError) -> u32 {
    u32::from(e)
}
