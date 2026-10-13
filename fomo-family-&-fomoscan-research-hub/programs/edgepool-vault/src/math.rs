//! Pure math — toàn bộ số học u128, checked, unit-testable (design §4).
//!
//! Đơn vị:
//! - tiền = lamports (u64); shares = raw (u64, 1 share = 1e9).
//! - `price_scaled` = NAV(lamports) * 1e9 / total_raw  (lamports per raw share, scale 1e9).
use anchor_lang::prelude::*;

use crate::errors::EdgepoolError;
use crate::state::{Vault, BOOTSTRAP_PRICE_SCALED, BPS_DENOM, PRICE_SCALE};

/// NAV = cash + marks − fee_credit. Revert khi âm.
pub fn nav_lamports(cash: u64, marks: u64, fee_credit: u64) -> Result<u64> {
    let gross = (cash as u128)
        .checked_add(marks as u128)
        .ok_or(EdgepoolError::MathOverflow)?;
    let nav = gross
        .checked_sub(fee_credit as u128)
        .ok_or(EdgepoolError::NavInvalid)?;
    u64::try_from(nav).map_err(|_| error!(EdgepoolError::MathOverflow))
}

/// Giá scale 1e9. Caller phải đảm bảo total_shares > 0 (guard riêng).
pub fn price_scaled(nav: u64, total_shares: u64) -> Result<u64> {
    require!(total_shares > 0, EdgepoolError::NavInvalid);
    let price = (nav as u128)
        .checked_mul(PRICE_SCALE)
        .ok_or(EdgepoolError::MathOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(EdgepoolError::MathOverflow)?;
    u64::try_from(price).map_err(|_| error!(EdgepoolError::MathOverflow))
}

/// Shares mint cho deposit (floor). Bootstrap (supply = 0): 1 SOL → 1 share.
pub fn mint_for_deposit(amount_lamports: u64, total_shares: u64, nav_pre: u64) -> Result<u64> {
    if total_shares == 0 {
        return Ok(amount_lamports);
    }
    require!(nav_pre > 0, EdgepoolError::NavInvalid);
    let minted = (amount_lamports as u128)
        .checked_mul(total_shares as u128)
        .ok_or(EdgepoolError::MathOverflow)?
        .checked_div(nav_pre as u128)
        .ok_or(EdgepoolError::MathOverflow)?;
    u64::try_from(minted).map_err(|_| error!(EdgepoolError::MathOverflow))
}

/// Payout khi burn shares (floor — lợi vault, chống dust).
pub fn payout_for(shares_raw: u64, nav: u64, total_shares: u64) -> Result<u64> {
    require!(total_shares > 0, EdgepoolError::NavInvalid);
    let payout = (shares_raw as u128)
        .checked_mul(nav as u128)
        .ok_or(EdgepoolError::MathOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(EdgepoolError::MathOverflow)?;
    u64::try_from(payout).map_err(|_| error!(EdgepoolError::MathOverflow))
}

/// bps của một lượng: amount * bps / 10000 (floor).
pub fn bps_of(amount: u64, bps: u16) -> Result<u64> {
    let out = (amount as u128)
        .checked_mul(bps as u128)
        .ok_or(EdgepoolError::MathOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(EdgepoolError::MathOverflow)?;
    u64::try_from(out).map_err(|_| error!(EdgepoolError::MathOverflow))
}

/// Phí hiệu suất trên phần giá vượt HWM:
/// fee = (price − hwm) * total_shares * fee_bps / (1e9 * 1e4)  → lamports.
pub fn perf_fee(price: u64, hwm: u64, total_shares: u64, fee_bps: u16) -> Result<u64> {
    if price <= hwm || fee_bps == 0 {
        return Ok(0);
    }
    let diff = (price - hwm) as u128;
    let fee = diff
        .checked_mul(total_shares as u128)
        .ok_or(EdgepoolError::MathOverflow)?
        .checked_mul(fee_bps as u128)
        .ok_or(EdgepoolError::MathOverflow)?
        .checked_div(PRICE_SCALE)
        .ok_or(EdgepoolError::MathOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(EdgepoolError::MathOverflow)?;
    u64::try_from(fee).map_err(|_| error!(EdgepoolError::MathOverflow))
}

/// Touch-settle: accrual phí hiệu suất nếu giá > HWM + ratchet HWM.
/// Trả về price_scaled sau settle (caller dùng để mint/burn tại giá này).
pub fn touch_settle(vault: &mut Vault, cash: u64) -> Result<u64> {
    let nav = nav_lamports(cash, vault.marks_lamports, vault.fee_credit)?;
    if vault.total_shares == 0 {
        return Ok(BOOTSTRAP_PRICE_SCALED);
    }
    let mut price = price_scaled(nav, vault.total_shares)?;
    if fee_plus(price, vault) {
        let fee = perf_fee(price, vault.hwm_price, vault.total_shares, vault.fee_bps)?;
        vault.fee_credit = vault
            .fee_credit
            .checked_add(fee)
            .ok_or(EdgepoolError::MathOverflow)?;
        let nav_after = nav.checked_sub(fee).ok_or(EdgepoolError::NavInvalid)?;
        price = price_scaled(nav_after, vault.total_shares)?;
        vault.hwm_price = vault.hwm_price.max(price);
    }
    Ok(price)
}

fn fee_plus(price: u64, vault: &Vault) -> bool {
    vault.fee_bps > 0 && price > vault.hwm_price
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(total_shares: u64, marks: u64, fee_credit: u64, hwm: u64, fee_bps: u16) -> Vault {
        Vault {
            manager: Pubkey::default(),
            keeper: Pubkey::default(),
            fee_sink: Pubkey::default(),
            total_shares,
            hwm_price: hwm,
            marks_lamports: marks,
            marks_slot: 0,
            fee_credit,
            epoch: 0,
            fee_bps,
            withdraw_fee_bps: 0,
            reserve_bps: 0,
            max_trade_bps: 0,
            max_marks_bps: 0,
            flags: 0,
            env: 0,
            bump: 255,
        }
    }

    #[test]
    fn nav_and_price_basic() {
        // Pool 10 SOL / 4 shares → NAV 10e9, giá 2.5 SOL/share.
        assert_eq!(nav_lamports(10_000_000_000, 0, 0).unwrap(), 10_000_000_000);
        assert_eq!(price_scaled(10_000_000_000, 4_000_000_000).unwrap(), 2_500_000_000);
    }

    #[test]
    fn nav_negative_reverts() {
        assert!(nav_lamports(100, 0, 101).is_err());
    }

    #[test]
    fn mint_bootstrap_and_normal() {
        // Bootstrap: nạp 2.5 SOL vào pool trống → 2.5 shares raw (2_500_000_000).
        assert_eq!(mint_for_deposit(2_500_000_000, 0, 0).unwrap(), 2_500_000_000);
        // Pool 10 SOL / 4 shares, nạp 2.5 → 1 share.
        assert_eq!(
            mint_for_deposit(2_500_000_000, 4_000_000_000, 10_000_000_000).unwrap(),
            1_000_000_000
        );
    }

    #[test]
    fn mint_floor_rounds_down() {
        // 3 raw-share pool với nav lẻ → floor, không vượt.
        let minted = mint_for_deposit(1, 3, 10).unwrap();
        assert_eq!(minted, 0); // 1*3/10 floor = 0 → caller reject DepositTooSmall
    }

    #[test]
    fn payout_floor() {
        assert_eq!(payout_for(1_000_000_000, 12_820_000_000, 5_000_000_000).unwrap(), 2_564_000_000);
        assert_eq!(payout_for(1, 10, 3).unwrap(), 3);
    }

    #[test]
    fn perf_fee_example_matches_design() {
        // (2.58 − 2.50) * 5 shares * 20% = 0.08 SOL (ví dụ mô phỏng đã verify).
        assert_eq!(
            perf_fee(2_580_000_000, 2_500_000_000, 5_000_000_000, 2_000).unwrap(),
            80_000_000
        );
        // Không vượt đỉnh → 0.
        assert_eq!(perf_fee(2_500_000_000, 2_500_000_000, 5_000_000_000, 2_000).unwrap(), 0);
        assert_eq!(perf_fee(2_400_000_000, 2_500_000_000, 5_000_000_000, 2_000).unwrap(), 0);
        // fee_bps = 0 → tắt.
        assert_eq!(perf_fee(2_600_000_000, 2_500_000_000, 5_000_000_000, 0).unwrap(), 0);
    }

    #[test]
    fn touch_settle_full_scenario() {
        // cash 12.5 + marks 0.4 = NAV 12.9; shares 5; hwm 2.5; fee 20%.
        let mut v = vault(5_000_000_000, 400_000_000, 0, 2_500_000_000, 2_000);
        let price = touch_settle(&mut v, 12_500_000_000).unwrap();
        assert_eq!(price, 2_564_000_000);            // giá sau phí
        assert_eq!(v.fee_credit, 80_000_000);        // 0.08 SOL
        assert_eq!(v.hwm_price, 2_564_000_000);      // ratchet
    }

    #[test]
    fn touch_settle_no_fee_below_hwm() {
        let mut v = vault(5_000_000_000, 0, 0, 2_500_000_000, 2_000);
        let price = touch_settle(&mut v, 12_000_000_000).unwrap(); // giá 2.4 < hwm 2.5
        assert_eq!(price, 2_400_000_000);
        assert_eq!(v.fee_credit, 0);
        assert_eq!(v.hwm_price, 2_500_000_000); // hwm giữ nguyên
    }

    #[test]
    fn touch_settle_bootstrap() {
        let mut v = vault(0, 0, 0, 1_000_000_000, 2_000);
        assert_eq!(touch_settle(&mut v, 0).unwrap(), 1_000_000_000);
    }

    #[test]
    fn bps_of_floors() {
        assert_eq!(bps_of(10_000, 0).unwrap(), 0);
        assert_eq!(bps_of(3, 2_000).unwrap(), 0); // 3*2000/10000 floor 0
        assert_eq!(bps_of(2_500_000_000, 1).unwrap(), 250_000);
    }

    #[test]
    fn overflow_is_guarded() {
        // u64::MAX * 1e9 vượt u128? không — nhưng mint với nav * shares u64 max phải an toàn
        // bằng checked; test đường chia 0 và nav invalid.
        assert!(price_scaled(1, 0).is_err());
        assert!(payout_for(1, 1, 0).is_err());
        assert!(mint_for_deposit(1, 10, 0).is_err());
    }
}
