//! Lifecycle happy-path: init → deposit (bootstrap + giá theo NAV) → marks →
//! settle (HWM fee) → withdraw (đúng giá, min_payout) → collect fees → pause.
mod common;

use common::*;

#[test]
fn vault_initializes_with_expected_state() {
    let mut env = Env::new("kestrel", 2000, 5000, 0);
    let v = vault_state(&env);
    assert_eq!(v.manager, env.manager.pubkey());
    assert_eq!(v.keeper, env.keeper.pubkey());
    assert_eq!(v.fee_bps, 2000);
    assert_eq!(v.max_marks_bps, 5000);
    assert_eq!(v.env, 0);
    assert_eq!(v.total_shares, 0);
    assert_eq!(v.hwm_price, 1_000_000_000); // bootstrap 1.00
    assert_eq!(v.fee_credit, 0);
    assert!(!v.is_paused());
    assert_eq!(mint_decimals(&env.svm, &env.share_mint), 9);
    assert_eq!(balance(&env.svm, &env.treasury), INITIAL_TREASURY_FUND);
}

#[test]
fn deposit_bootstrap_then_price_at_nav() {
    // fee 0 để số liệu sạch.
    let mut env = Env::new("bootstrap", 0, 5000, 0);
    let user_bal0 = balance(&env.svm, &env.user.pubkey());

    // 1) Bootstrap: nạp 1 SOL → 1 share (1e9 raw), price vẫn 1.00.
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    let v = vault_state(&env);
    assert_eq!(v.total_shares, 1_000_000_000);
    assert_eq!(mint_supply(&env.svm, &env.share_mint), 1_000_000_000);
    assert_eq!(
        token_amount(&env.svm, &env.ata_of(&env.user)),
        1_000_000_000
    );
    assert_eq!(balance(&env.svm, &env.treasury), 1_010_000_000);
    assert_eq!(
        user_bal0 - balance(&env.svm, &env.user.pubkey()),
        LAMPORTS_PER_SOL
            + 5000
            + env.svm.minimum_balance_for_rent_exemption(165)
            + env.svm.minimum_balance_for_rent_exemption(8) // deposit + fee + ATA + operation receipt
    );

    // 2) Keeper đẩy marks +0.1 SOL → NAV 1.11 → giá 1.11.
    let ix = ix_update_marks(&env, &env.keeper, 100_000_000);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));

    // 3) user2 nạp 1 SOL tại giá 1.11 → floor(1e9 * 1e9 / 1.11e9) = 900_900_900 raw.
    let ix = ix_deposit(&env, &env.user2, LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]));
    assert_eq!(token_amount(&env.svm, &env.ata_of(&env.user2)), 900_900_900);
    assert_eq!(vault_state(&env).total_shares, 1_900_900_900);
    assert_eq!(mint_supply(&env.svm, &env.share_mint), 1_900_900_900);
    assert_eq!(balance(&env.svm, &env.treasury), 2_010_000_000);
}

#[test]
fn withdraw_pays_at_current_price_with_min_payout_guard() {
    let mut env = Env::new("withdraw", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL); // cash 1.01, shares 1e9
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));

    // giá 1.01; rút 0.4e9 raw → payout chính xác 404_000_000.
    let bal0 = balance(&env.svm, &env.user.pubkey());
    let ix = ix_withdraw(&env, &env.user, 400_000_000, 404_000_000); // min_payout = exact
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    assert_eq!(
        balance(&env.svm, &env.user.pubkey()),
        bal0 + 404_000_000 - 5000 - env.svm.minimum_balance_for_rent_exemption(8)
    );
    assert_eq!(token_amount(&env.svm, &env.ata_of(&env.user)), 600_000_000);
    assert_eq!(vault_state(&env).total_shares, 600_000_000);
    assert_eq!(
        balance(&env.svm, &env.treasury),
        1_010_000_000 - 404_000_000
    );

    // min_payout cao hơn payout thật 1 lamport → PayoutBelowMin, state không đổi.
    let ix = ix_withdraw(&env, &env.user, 100_000_000, 101_000_001);
    assert_err(
        send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::PayoutBelowMin),
    );
    assert_eq!(vault_state(&env).total_shares, 600_000_000);
}

#[test]
fn hwm_fee_charges_only_new_profit_and_ratchets() {
    // Case chuẩn: pool 10 SOL, marks +2 SOL (profit ít hơn cap), fee 20%.
    let mut env = Env::new("fees", 2000, 5000, 0);
    let ix = ix_deposit(&env, &env.user, 10 * LAMPORTS_PER_SOL); // shares 10e9, cash 10.01
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));

    let ix = ix_update_marks(&env, &env.keeper, 2_000_000_000);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));

    // settle: price 1.201 > hwm 1.0 → fee = 0.201 * 10e9 * 20% = 402_000_000.
    let ix = ix_settle_epoch(&env, &env.keeper);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
    let v = vault_state(&env);
    assert_eq!(v.fee_credit, 402_000_000);
    assert_eq!(v.hwm_price, 1_160_800_000); // (12.01e9 − 0.402e9)/10e9
    assert_eq!(v.epoch, 1);

    // settle lần 2: giá == hwm → không thu thêm.
    let ix = ix_settle_epoch(&env, &env.keeper);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
    assert_eq!(vault_state(&env).fee_credit, 402_000_000);

    // collect đúng credit về fee_sink (= manager ở v1), vượt credit → revert.
    let bal0 = balance(&env.svm, &env.manager.pubkey());
    let ix = ix_collect_fees(&env, &env.manager, 402_000_000);
    assert_ok(send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]));
    assert_eq!(
        balance(&env.svm, &env.manager.pubkey()),
        bal0 + 402_000_000 - 5000
    );
    assert_eq!(vault_state(&env).fee_credit, 0);
    let ix = ix_collect_fees(&env, &env.manager, 1);
    assert_err(
        send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::FeeExceedsCredit),
    );
}

#[test]
fn pause_blocks_deposit_but_never_withdraw() {
    let mut env = Env::new("paused", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));

    let ix = ix_set_paused(&env, &env.manager, true);
    assert_ok(send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]));
    assert!(vault_state(&env).is_paused());

    // Deposit bị chặn…
    let ix = ix_deposit(&env, &env.user2, LAMPORTS_PER_SOL);
    assert_err(
        send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::VaultPaused),
    );

    // …nhưng withdraw vẫn chạy (thoát vốn không thể bị khóa).
    let bal0 = balance(&env.svm, &env.user.pubkey());
    let ix = ix_withdraw(&env, &env.user, 100_000_000, 101_000_000);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    assert_eq!(
        balance(&env.svm, &env.user.pubkey()),
        bal0 + 101_000_000 - 5000 - env.svm.minimum_balance_for_rent_exemption(8)
    );

    // Unpause → deposit mở lại.
    let ix = ix_set_paused(&env, &env.manager, false);
    assert_ok(send_tx(&mut env.svm, &env.manager, &[&env.manager], &[ix]));
    let ix = ix_deposit(&env, &env.user2, LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]));
}

#[test]
fn stale_marks_block_pricing_until_refresh() {
    let mut env = Env::new("stale", 0, 5000, 0);
    let ix = ix_deposit(&env, &env.user, LAMPORTS_PER_SOL);
    assert_ok(send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]));
    let ix = ix_update_marks(&env, &env.keeper, 100_000_000);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));

    // Warp vượt MAX_STALE_SLOTS (750) → fail-closed cả deposit lẫn withdraw.
    env.svm.warp_to_slot(100_000);
    let ix = ix_deposit(&env, &env.user2, LAMPORTS_PER_SOL);
    assert_err(
        send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::StaleMarks),
    );
    let ix = ix_withdraw(&env, &env.user, 100_000_000, 0);
    assert_err(
        send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]),
        ep_err(edgepool_vault::errors::EdgepoolError::StaleMarks),
    );

    // Keeper refresh (cùng giá trị) → pricing mở lại; deposit 0.5 SOL tại NAV 1.11.
    let ix = ix_update_marks(&env, &env.keeper, 100_000_000);
    assert_ok(send_tx(&mut env.svm, &env.keeper, &[&env.keeper], &[ix]));
    let ix = ix_deposit(&env, &env.user2, MIN_DEPOSIT);
    assert_ok(send_tx(&mut env.svm, &env.user2, &[&env.user2], &[ix]));
    // minted = floor(0.5e9 * 1e9 / 1.11e9) = 450_450_450.
    assert_eq!(token_amount(&env.svm, &env.ata_of(&env.user2)), 450_450_450);
}

#[test]
fn duplicate_operation_receipt_rejects_replay() {
    let mut env = Env::new("nonce-replay", 0, 5000, 0);
    let op_id = next_operation_id();
    let ix = ix_deposit_with_id(&env, &env.user, LAMPORTS_PER_SOL, op_id);
    assert_ok(send_tx(
        &mut env.svm,
        &env.user,
        &[&env.user],
        &[ix.clone()],
    ));
    let replay = send_tx(&mut env.svm, &env.user, &[&env.user], &[ix]);
    assert!(replay.is_err(), "same operation receipt must reject replay");
    assert_eq!(vault_state(&env).total_shares, 1_000_000_000);
    assert_eq!(mint_supply(&env.svm, &env.share_mint), 1_000_000_000);
}
