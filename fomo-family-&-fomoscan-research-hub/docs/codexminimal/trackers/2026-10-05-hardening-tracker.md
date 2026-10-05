# Tracker — Hardening P5 + cleanup

- Topic: hardening
- Intent: `docs/codexminimal/idsd/2026-10-05-hardening-intent.md`
- Started: 2026-10-05

## Phases

- [x] H1 purge endpoint (service + ADMIN route + asserts): `done`
  (`purgeExpired()` + `POST /api/auth/purge` ADMIN+@Audit; fake += deleteMany
  expiry-aware; §14 GREEN: xóa đúng rows hết hạn, giữ rows live)
- [x] H2 failed-login audit (service hooks + asserts): `done`
  (`auth.login_failed` + `auth.verify_failed`, best-effort never-throw,
  không log secret; §15 GREEN)
- [x] H3 openapi (purge path + 201 + CSRF note) + tracker cleanup: `done`
  (verify/register/login += 201; purge path; bearerAuth CSRF note;
  copy-trade P5 + fund-roles-auth P3/P4 checkbox tồn → done/xóa)
- [x] H4 typecheck + live smoke + build + review: `done`
  (root tsc BE+FE ✅; 13/13 assert suites GREEN; live purge {0 sessions, 21 nonces}
  + 403/401 matrix + login_failed audit row; FE :3001 200 + wallets/me regression;
  reviewer APPROVE)

## Review gate — APPROVE

Purge chỉ xóa expired (assert + live); guard order 401/403 đúng; failed-audit
never-throw, không log secret; purge ADMIN-only + tự audit. Contract additive
(path mới, 201, optional fields). Thay đổi chấp nhận được: identity rác giờ 404
(trước 400 qua assertWallet) — không test nào phụ thuộc. Không đụng
copy-trade/config/.env. Non-goals giữ nguyên (không loop, không rate-limit).

## Handoff log

- 2026-10-05: intake xong (manual purge, dual failed-audit actions, TOCTOU giữ nguyên).
- 2026-10-05: H1–H4 đóng. BE rebuild (route purge mới) + smoke lại xanh.

## Handoff log

- 2026-10-05: intake xong (manual purge, dual failed-audit actions, TOCTOU giữ nguyên).
