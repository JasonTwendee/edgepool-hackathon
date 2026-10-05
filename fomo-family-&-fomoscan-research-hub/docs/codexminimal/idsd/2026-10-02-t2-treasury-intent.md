# Intent — T2 treasury policy (reserve/fee/lock, per-vault)

- Date: 2026-10-02
- Stage: intent-bounded → execution (vaults/* không protected; không đụng copy-trade/config)
- Parent: fund intent Rev 2 P5-T2, fund spec §9 + D17–D20.
- Trả lời D/E treo ở mức bounded: D20 lock (có, configurable, default 0);
  D20 fee (có, default 0); reserve (có, default 10%); D18 window (chưa — QUEUED+settle
  hiện tại chính là batch window); D21 PnL theo NAV shares (giữ); E23 fee đã có
  feeBps/HWM + thêm withdraw fee → treasury.

## 1. Intent contract

- **Intent**: mỗi vault có chính sách treasury显式 (reserve/fee/lock) do ADMIN đặt,
  enforce ở request + settle, phí chảy vào `treasurySol`显式 — admin rút tiền không
  bao giờ phá accounting (§9 invariants giữ nguyên).
- **Business rules**:
  - `reserveBps` default 0 (opt-in; default 10% ban đầu bị revert vì phá full-withdraw
    legacy — quyết định trong build: backward-compat trước, ADMIN bật khi cần);
    `withdrawFeeBps` default 0; `lockHours` default 0.
  - Request: lock check qua deposit SETTLED gần nhất của identity (depositor string
    HOẶC userId khi có); reserve check qua `lastEpoch.navSol` (chưa có epoch → skip,
    bootstrap); vượt → 400 message rõ (bao gồm thời điểm unlock).
  - Settle: payout = shares×price − fee; fee cộng dồn `treasurySol`; epoch ghi nhận.
  - Policy change = ADMIN op + reason + audit (`vault.set_policy`).
- **Non-goals**: withdrawal window theo lịch, auto cash-out theo profit %, treasury
  rút ra ngoài (chỉ accumulate + đọc), đổi feeBps/HWM hiện tại.
- **Acceptance**: lock reject trước giờ / pass sau; fee trừ đúng + treasury tăng đúng;
  reserve reject khi payout vượt floor; vault cũ (policy default) behavior y nguyên;
  asserts + live smoke xanh.

## 2. Decisions

- D-T2.1 enforce ở request (lock/reserve) + settle (fee) — tách đúng chỗ dữ liệu sẵn có.
- D-T2.2 identity match = depositor string OR userId (phủ cả legacy lẫn linked).
- D-T2.3 fee vào `treasurySol` trên Vault (đọc qua status), không tạo bảng mới.
- D-T2.4 defaults bảo toàn backward-compat (reserve chỉ có nghĩa khi có epoch).

## 3. Bounded spec

1. Prisma: `Vault += reserveBps Int @default(1000), withdrawFeeBps Int @default(0),
   lockHours Int @default(0), treasurySol Decimal(24,12) @default(0)` + migration.
2. `VaultService`: `setPolicy(vaultId, {reserveBps?, withdrawFeeBps?, lockHours?})`
   (validate 0..10000 / 0..10000 / 0..8760); `requestWithdraw` += lock+reserve;
   `settleEpoch` += fee+treasury; `status()` += policy + treasury.
3. Controller: `POST /api/vaults/:id/policy` (ADMIN+Audit). DTO `VaultPolicyDto`.
4. openapi: path + `VaultPolicy` schema (additive). `assert-treasury.ts` (mocked).
5. Live smoke (ADMIN): policy set → lock reject → fee settle → treasury đọc.

## 4. Test contract

Mocked asserts + `tsc` + live smoke + regression asserts cũ. Review gate trước đóng.
