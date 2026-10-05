# Intent — Hardening P5 + tracker cleanup

- Date: 2026-10-05
- Stage: intent-bounded → execution (user chọn: Hardening P5 + cleanup)
- Parent: fund-roles-auth review gate (non-blocking suggestions) + fe-auth-plus CSRF note.

## 1. Intent contract

- **Intent**: đóng các follow-up hardening còn treo, không thêm behavior sản phẩm.
- **Business rules (BE)**:
  - `POST /api/auth/purge` (ADMIN, audited): xóa sessions + auth_nonces đã hết hạn,
    trả về counts. Manual-only, không loop ngầm (theo quy ước repo).
  - Audit failed logins: `auth.login_failed` (credential 401, actor=username) và
    `auth.verify_failed` (wallet 401, actor=wallet, reason ∈ expired/bad-signature).
    Best-effort: audit fail không bao giờ phá auth (try/catch, như interceptor).
    Không log password/signature/nonce.
  - Không đụng copy-trade/**, config, .env.
- **Docs**: openapi register/login/verify ghi thêm response 201 (Nest POST default;
  live đã trả 201); CSRF note cho cookie transport; sửa checkbox tracker tồn
  (copy-trade P5, fund-roles-auth P3/P4 mục lặp); solution-v2 D giữ blocked.
- **Non-goals**: loop purge tự động, rate-limit login, link vi-tk, on-chain vault.
- **Acceptance**: purge xóa đúng rows hết hạn (giữ rows còn hạn); failed login ghi
  audit đúng action; tsc + build xanh; live smoke full matrix; reviewer APPROVE.

## 2. Decisions

- D-H1 purge manual qua endpoint ADMIN (nhất quán với auto-fire/manage tick pattern),
  không cron trong web runtime.
- D-H2 audit cả expired-nonce (tín hiệu anomaly), filter được bằng action riêng.
- D-H3 TOCTOU bootstrap: giữ nguyên (sandbox-acceptable, đã ghi nhận).

## 3. Bounded spec

1. `auth.service`: `purgeExpired()` + failed-audit hooks (inject AuditService).
2. `auth.controller`: `POST purge` (AuthGuard+RolesGuard ADMIN + @Audit).
3. `auth.module`: import AuditModule.
4. `assert-auth.ts`: fake += authNonce.deleteMany + auditLog.create; §14 purge, §15 failed-audit.
5. openapi: purge path + 201 responses + CSRF note.
6. Tracker cleanup + live smoke + review.
