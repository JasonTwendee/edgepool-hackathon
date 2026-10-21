//! Gates & negative paths: min deposit, caps, liquidity, reserve floor,
//! roles, env gate, cash-limited fee collection.
mod common;

use anchor_lang::error::ErrorCode;
use common::*;

fn constraint_has_one() -> u32 {
    ErrorCode::ConstraintHasOne as u32
}

#[test]
fn deposit_below_minimum_rejected() {
    let mut env = Env::new("min", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, 400_000_000);
    assert_err(
        send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::DepositTooSmall),
    );
}

#[test]
fn marks_delta_cap_then_marks_cap() {
    let mut env = Env::new("caps", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, 10 * LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    // cash 10.01e9 → delta cap 20% của NAV cũ = 2.002e9.
    let ix = ix_update_marks(&env, &env.keeper, 2_100_000_000);
    assert_err(
        send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::MarksDeltaExceeded),
    );
    let ix = ix_update_marks(&env, &env.keeper, 2_000_000_000);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
    // NAV giờ 12.01e9 → delta cap 2.402e9: +2.4e9 ok.
    let ix = ix_update_marks(&env, &env.keeper, 4_400_000_000);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
    // Trần marks = 50% cash (5.005e9): +0.7e9 → 5.1e9 vượt trần, delta vẫn hợp lệ.
    let ix = ix_update_marks(&env, &env.keeper, 5_100_000_000);
    assert_err(
        send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::MarksCapExceeded),
    );
    // Trạng thái giữ nguyên ở 4.4e9 (tx fail không đổi state).
    assert_eq!(vault_state(&env).marks_lamports, 4_400_000_000);
}

#[test]
fn withdraw_blocked_when_cash_is_deployed_but_partial_ok() {
    let mut env = Env::new("illiquid", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL); // cash 1.01e9, shares 1e9
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    let ix = ix_update_marks(&env, &env.keeper, 200_000_000); // NAV 1.21e9, price 1.21
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));

    // Rút hết (gồm cả lãi unrealized) → payout 1.21e9 > cash 1.01e9 → chặn.
    let ix = ix_withdraw(&env, &env.user, 1_000_000_000, 0);
    assert_err(
        send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::InsufficientLiquidity),
    );

    // Rút phần nhỏ trong khả năng cash vẫn chạy: 0.1e9 share → 121_000_000.
    let ix = ix_withdraw(&env, &env.user, 100_000_000, 121_000_000);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    assert_eq!(vault_state(&env).total_shares, 900_000_000);
}

#[test]
fn reserve_floor_protects_liquidity() {
    let mut env = Env::new("reserve", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL); // cash 1.01e9
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    let ix = ix_update_policy(&env, &env.manager, 0, 5000); // reserve 50%
    assert_ok(send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]));

    // NAV 1.01e9, floor 505e6. Rút 0.6e9 → payout 606e6 → leftover 404e6 < floor → chặn.
    let ix = ix_withdraw(&env, &env.user, 600_000_000, 0);
    assert_err(
        send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::ReserveFloorBreached),
    );

    // Rút 0.1e9 → payout 101e6; leftover 909e6 ≥ floor → ok.
    let ix = ix_withdraw(&env, &env.user, 100_000_000, 0);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
}

#[test]
fn withdraw_requires_shares_and_positive_amount() {
    let mut env = Env::new("shares", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user2, MIN_DEPOSIT); // user2 có ATA + 0.5e9 shares
    assert_ok(send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]));

    let ix = ix_withdraw(&env, &env.user2, 0, 0);
    assert_err(
        send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::InvalidParam),
    );

    let ix = ix_withdraw(&env, &env.user2, 600_000_000, 0);
    assert_err(
        send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::InsufficientShares),
    );
}

#[test]
fn roles_are_enforced() {
    let mut env = Env::new("roles", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));

    // user không phải keeper → has_one constraint.
    let ix = ix_update_marks(&env, &env.user, 1);
    assert_err(
        send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]),
        constraint_has_one(),
    );
    // keeper không phải manager → không pause được.
    let ix = ix_set_paused(&env, &env.keeper, true);
    assert_err(
        send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]),
        constraint_has_one(),
    );
    // user không ghi được sim trade.
    let ix = ix_record_sim_trade(&env, &env.user);
    assert_err(
        send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]),
        constraint_has_one(),
    );
    // keeper hợp lệ trên devnet vault.
    let ix = ix_record_sim_trade(&env, &env.keeper);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
}

#[test]
fn sim_trades_rejected_on_mainnet_env() {
    let mut env = Env::new("prod", 2000, 0, 1); // env = 1
    let ix = ix_record_sim_trade(&env, &env.keeper);
    assert_err(
        send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::EnvMismatch),
    );
    // deposit/withdraw vẫn chạy thường (env chỉ gate sim/swap).
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
}

#[test]
fn collect_fees_is_cash_limited() {
    // cash 0.51 SOL, không trần marks → đẩy marks theo cấp 20% cho tới khi
    // fee accrual (20% lãi) vượt cash thật.
    let mut env = Env::new("cashlimit", 2000, 0, 0);
    let ix = ix_deposit(&env, &env.user, MIN_DEPOSIT); // cash 510_000_000
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));

    let mut marks: u64 = 0;
    for _ in 0..20 {
        let nav = 510_000_000u128 + marks as u128;
        let delta = (nav / 5) as u64;
        marks += delta;
        let ix = ix_update_marks(&env, &env.keeper, marks);
        assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
        if marks > 3_000_000_000 {
            break;
        }
    }

    let ix = ix_settle_epoch(&env, &env.keeper);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
    let fee = vault_state(&env).fee_credit;
    assert!(fee > 510_000_000, "fee_credit {fee} phải vượt cash 510_000_000");

    // Collect bằng đúng cash → ok; thêm 1 lamport → InsufficientLiquidity.
    let ix = ix_collect_fees(&env, &env.manager, 510_000_000);
    assert_ok(send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]));
    assert_eq!(balance(&env.svm, &env.treasury), 0);
    let ix = ix_collect_fees(&env, &env.manager, 1);
    assert_err(
        send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::InsufficientLiquidity),
    );
}
