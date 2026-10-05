# Intent — Collab/KOL earnings: chia phí 80/15/5 (report §4)

- Date: 2026-10-05
- Stage: intent-bounded → execution (user: report nói collab có value riêng, cần cập nhật)
- Parent: `edgepool-core-logic-report.html` §4 "Chia phí" + Phase C vault accounting.

## 1. Intent contract

- **Report §4**: phí hiệu suất 20% trên lãi mới vượt HWM, không management fee.
  Chia PROFIT: **80% depositors · 15% trader đối tác · 5% Edgepool**.
  VD NAV 10→11: depositors +0.80, trader +0.15, Edgepool +0.05.
- **Gap hiện tại**: `settleEpoch` trừ fee khỏi NAV nhưng fee "bốc hơi" (chỉ lưu
  `EpochCheckpoint.feeSol`); treasury chỉ nhận withdraw-fee; không sổ partner;
  KOL/trader đối tác không có value nào ghi nhận.
- **Business rules (BE)**:
  - Khi `feeSol > 0`: `partnerShare = fee × 75%` (= 15% profit), `edgepoolShare = fee × 25%` (= 5% profit).
  - `edgepoolShare` + phần dư làm tròn → `treasurySol`.
  - `partnerShare` chia pro-rata `weightBps` cho traders ACTIVE của vault → rows
    `PartnerPayout` (ACCRUED). Không có active trader (hoặc tổng weight 0) →
    partnerShare về treasury (Edgepool tạm giữ).
  - Bảo toàn: partner + edgepool + nav = navSol đầu vào (dust làm tròn về treasury).
  - `feeBps` đưa vào policy ADMIN (0..10000, default 0 giữ nguyên) để bật phí khi cần.
  - `GET /api/vaults/:id/earnings?trader=` (public read như status/traders):
    totals + rows, filter theo trader.
  - `status()` += `partnerAccruedSol`; settle result += payouts (additive).
- **Business rules (FE)**: VaultCard read-section += dòng earnings (tổng partner
  accrued + top traders). Non-ADMIN/KOL nhìn thấy (đúng đối tượng nhận value).
- **Non-goals**: payout on-chain/rút earnings (ACCRUED là sổ ghi nhận; cash-out là
  phase sau), link user↔trader-wallet, per-vault split config (hằng số theo report),
  đụng copy-trade/config.
- **Acceptance**: report VD 10→11 ra đúng 0.15/0.05; pro-rata 2 traders đúng;
  không trader → treasury; feeBps 0 → không rows; bảo toàn số học; tsc + build xanh;
  live E2E trên fee-vault; reviewer APPROVE.

## 2. Decisions

- D-K1 hằng số split theo report (75/25 của fee), chưa per-vault config.
- D-K2 dust làm tròn về treasury (bảo toàn tuyệt đối, đơn giản hơn phân phối dư).
- D-K3 earnings public-read (nhất quán vault reads hiện tại); KOL filter bằng ví.

## 3. Bounded spec

1. Prisma `PartnerPayout` + migration + regen client.
2. `vault.service`: split trong settle + `earnings()` + status/settle shape + policy feeBps.
3. DTO policy += feeBps; controller passthrough + `GET :id/earnings`.
4. `assert-partner.ts` (report VD + pro-rata + no-trader + zero-fee + conservation).
5. openapi PartnerPayout schema + earnings path + policy feeBps.
6. FE `getVaultEarnings` + VaultCard earnings block.
7. Live E2E + review + docs.
