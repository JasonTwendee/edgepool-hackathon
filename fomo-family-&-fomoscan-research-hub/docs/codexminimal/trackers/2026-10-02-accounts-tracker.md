# Tracker — Tai khoan tk+mk + FE phan quyen

- Topic: accounts
- Intent: `docs/codexminimal/idsd/2026-10-02-accounts-intent.md`
- Started: 2026-10-02

## Phases

- [x] A1 BE tk+mk (schema + scrypt + register/login + contract): `done`
  (schema/migration/user_credentials + password.ts + auth.service/controller/DTO +
  openapi register/login đã có; bổ sung: setRole chấp nhận wallet | cred:u | username,
  list() kèm username/email, User schema + set-role param doc)
- [x] A2 FE (AuthPanel tab + isAdmin gating + admin bots default): `done`
  (AuthPanel tab Tài khoản đã có; FomoRightPanel/VaultCard/TraderProfile isAdmin gating
  đã có; AdminPanel default tab bots; bổ sung: FundUser username/email + users tab
  hiện @username + placeholder "Wallet hoặc username"; fix AuthPanel JSX thừa </div>
  làm gãy tsc)
- [x] A3 asserts + live + build + review: `done`
  (assert-auth §13 setRole-by-username GREEN; root tsc BE+FE ✅; FE build ✅;
  live: login 3 TK đúng role, sai pw 401, trùng 400, me/logout/revoke, set-role
  username+cred:user OK, non-ADMIN 403, list có username; openapi YAML valid 39 paths;
  reviewer APPROVE)

## Review gate — APPROVE

setRole resolver giữ thứ tự 400-trước-404; update theo id (unique); list additive;
seed script standalone (không wire vào runtime), pw từ env bắt buộc, không in secret;
không đụng copy-trade/config/.env. Lưu ý: input rác không-phải-username giờ 404
(trước 400) — chấp nhận được, không có test nào phụ thuộc.

## Seeded accounts (DB fomo_dev, pw bàn giao riêng — KHÔNG commit)

- admin / ADMIN (wallet cred:admin)
- user / USER (wallet cred:user)
- kol / KOL (wallet cred:kol)
- temp_01 / USER (tài khoản smoke, đã demote về USER)

## Handoff log

- 2026-10-02: intake xong (scrypt zero-dep, an UI thay xoa, Follow la copy-control).
- 2026-10-05: A1–A3 đóng. BE/FE rebuild (image cũ thiếu route register/login) + smoke lại xanh.
