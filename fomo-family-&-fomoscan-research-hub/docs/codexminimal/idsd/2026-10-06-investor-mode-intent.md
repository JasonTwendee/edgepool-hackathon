# Intent — Investor Mode (role-based views)

- Date: 2026-10-06
- Stage: intent-bounded → execution (user duyệt suggestion)
- Parent: customer feedback (màn user như terminal trader, khó hiểu).

## 1. Intent contract

- **USER = investor** (deposit → ngồi yên → xem returns). **ADMIN = terminal** hiện tại.
  **KOL = USER + partner earnings** (đúng đối tượng nhận tiền).
- **BE**: `GET /api/vaults/mine` (auth required) — shares/value/deposited/
  withdrawn/returns/queues theo session identity (userId + wallet match).
- **FE**:
  - Right panel non-admin: **MyVault** (shares, value, returns, In/Out) thay
    trader positions; VaultCard bỏ In/Out (chuyển vào MyVault), partner earnings
    chỉ KOL/ADMIN; trader positions + copy history giữ cho ADMIN.
  - Sidebar "Your rank" card ẩn với non-admin; weight pill → "Copy weight",
    admin-only; leaderboard giữ cho mọi role (minh bạch).
  - Timeframe += 3D.
- **Non-goals**: đổi copy engine, đổi fee, BE reads auth (giữ public cho analyst).
- **Acceptance**: login user → My Vault có số; KOL thấy partner; ADMIN đủ;
  tsc + build xanh; asserts GREEN; live verify 3 roles.
