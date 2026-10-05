# Intent — Tai khoan tk+mk + FE phan quyen theo vai tro

- Date: 2026-10-02
- Stage: intent-bounded → execution (user chot: them tk+mk + FE dung mo ta)
- Parent: fund spec §§2–4 (roles), FE hien tai.

## 1. Intent contract

- **Intent**: dang nhap/dang ki bang tk+mk song song vi; FE user PnL-first (an nut
  nap/copy); admin bot-console; copy-trade UI an (logic o BE).
- **Business rules (BE)**:
  - User += username unique + email unique? + passwordHash? (wallet users null).
  - Register: username [a-z0-9_]{3,32} + password ≥8 + email optional → role USER
    (khong tu gan role); trung → 400; tao session + cookie nhu verify.
  - Login: username + password → sai → 401 (khong lo username ton tai hay khong).
  - Hash scrypt zero-dep (`scrypt$N$r$p$salt$key`, timingSafeEqual).
  - Wallet flow giu nguyen; 2 loai user doc lap (link vi-tk la follow-up).
- **Business rules (FE)**:
  - AuthPanel them tab Tai khoan (register/login) canh tab Vi.
  - Non-ADMIN an: Send card, nut Copy + modal, CopyHistory, VaultCard In/Out,
    nut Follow (TraderProfile). Giulai: PnL chart/swaps/holdings/positions-read/
    VaultCard read.
  - ADMIN thay day du + AdminPanel (default tab bots).
- **Non-goals**: link vi-tk, quen mat khau/email verify, 2FA, sua copy logic BE,
  xoa components (an bang dieu kien, khong xoa file).
- **Acceptance**: register/login/logout tk+mk live; sai pw 401; trung 400;
  non-ADMIN khong thay nut (kiem HTML); ADMIN du; tsc + build xanh.
- **Constraints**: khong dep moi; khong sua copy-trade/config; additive openapi.

## 2. Decisions

- D-P1 scrypt thay bcryptjs (zero-dep, KDF chuan; review gate xac nhan params).
- D-P2 an UI thay vi xoa (gi code cho demo/admin sau; khong mat lich su).
- D-P3 Follow toggle la copy-engine control → an voi non-ADMIN.

## 3. Bounded spec

1. Prisma User += username/email/passwordHash (unique?, migration) + regen.
2. `common/auth/password.ts` (hash/verify/validate) + asserts.
3. `auth.service`: register/login (+revoke tai dung); controller 2 endpoints
   (cookie nhu verify); DTOs; openapi paths+schemas.
4. `lib/api.ts`: registerAccount/loginAccount; `AuthPanel` tab Tai khoan.
5. `FomoRightPanel` + `VaultCard` + `TraderProfile`: prop isAdmin, an theo quy tac;
   `page.tsx` truyen role; AdminPanel default tab bots.
6. Asserts BE + live smoke + tsc/build + review.

## 4. Test/agents/risks

Primary generic; gate reviewer (scrypt params, enum user, UI khong lo logic authz).
Rui ro: trung username/email race (mitigate: unique DB + map loi → 400).
