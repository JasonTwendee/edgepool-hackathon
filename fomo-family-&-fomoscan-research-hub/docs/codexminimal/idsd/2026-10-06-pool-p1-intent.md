# Intent — Pool app P1 (pools index + NAV engine + seed)

- Date: 2026-10-06
- Stage: intent-bounded → execution (user duyệt: terminal → /terminal, pool = bot + 3-5 traders)
- Parent: design handoff (pools > detail > partner), pool-math.ts.

## 1. Mô hình chốt (khớp ý hiểu của user)

- **1 pool = 1 Vault + 1 Bot (AUTO) + 3–5 VaultTraders.** Trader trade lãi/lỗ
  → copy engine fire theo → positions mở → NAV pool lên/xuống → user theo pool
  nào thì thấy lãi/lỗ của pool đó qua NAV/share.
- **Gap phải lấp**: NAV hiện tại đang **nhập tay** mỗi epoch (`navSol` param).
  Để pool "sống" theo trader, P1 thêm **NAV engine**: NAV = cash + Σ vị thế mở
  mark-to-market (giá live DataStream) + realized đã chốt. Settle không truyền
  navSol → tự tính (param thành optional, tương thích ngược).
- Terminal hiện tại chuyển sang `/terminal` (admin), app pool làm `/` chính.

## 2. Bounded spec P1

1. Prisma Vault += `kind` (basket/partner), `status` (live/paused), `listing`
   (public/unlisted), `maxSlots`, `maxTraders` + migration + regen.
2. `GET /api/pools` (public): id/name/kind/status/listing/NAV/sharePrice/HWM/
   pnl(period)/slots{used,max}/traders(handle/rank/exposure)/myHolding?(optional auth).
3. NAV engine: `computeNav(vaultId)` (cash + open copy-order MTM + realized);
   `settle` cho navSol optional (thiếu → auto).
4. Seed: basket flagship (top 5 active + bot AUTO) + 1 partner demo pool (paused? live?).
5. FE: `/` → pools index (theo tokens.css), `/terminal` = terminal cũ (move file).
6. Asserts + openapi + live verify.

## 3. Non-goals P1

Detail Calm (P2), Portfolio (P3), partner portal (P4), Advanced (P5), paywall mask (P2).
