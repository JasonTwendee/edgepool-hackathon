# Intent — FE auth nang cao (browser-wallet + role guard + httpOnly cookie)

- Date: 2026-10-02
- Stage: intent-bounded → execution (FE + auth module, khong dung protected files)
- Parent: T3 FE, fund spec §§3–4 (roles).

## 1. Intent contract

- **Intent**: login 1-click bang vi browser (Phantom/Solflare injected), session
  chay qua httpOnly cookie (Bearer van tuong thich), UI an/hien theo role —
  operator khong can paste tay, token khong nam trong JS-accessible storage.
- **Business rules**:
  - Browser sign: `window.solana.connect()` → nonce BE → `signMessage` → verify.
    Khong thay vi thi giu paste-signature/paste-token cu (fallback, khong xoa).
  - Cookie `fomo_session` (HttpOnly, Path=/, SameSite=Lax, Max-Age 7d; Secure theo
    `COOKIE_SECURE=1`). Guards doc Bearer truoc, cookie sau. Logout xoa session row
    + clear cookie.
  - FE `credentials: 'include'` cho mọi authed call (qua Next rewrites same-origin).
  - Route-guard UI: tabs write (users set-role, vault create/trader/policy, bot
    create/mode, tick) chi hien khi role ADMIN; non-ADMIN thay lists read-only +
    ghi chu. Muc dich: khong goi API vo ich + khong hieu lam quyen.
  - CSRF: SameSite=Lax du cho demo same-origin; production can CSRF token +
    Secure (ghi follow-up, khong lam slice nay).
- **Non-goals**: @solana/wallet-adapter deps, httpOnly-only (Bearer giu cho scripts/
  tuong thich nguoc), doi TTL/session model, mobile wallet (WalletConnect).
- **Acceptance**: login browser that (neu co vi) + cookie Set-Cookie hien dien;
  logout xoa; guard nhan cookie khi khong Bearer; non-ADMIN khong thay nut write;
  tsc + build + live smoke xanh.
- **Constraints**: khong dep moi (cả BE lẫn FE); khong sua copy-trade/config;
  additive-only openapi; tsx-safe.

## 2. Decisions

- D-F1 injected `window.solana` thay wallet-adapter (zero-dep, dung repo style;
  adapter la follow-up khi can multi-wallet/modal dep).
- D-F2 dual Bearer+cookie (tuong thich nguoc scripts/smoke cu; FE moi uu tien cookie).
- D-F3 guard UI la UX (bao mat that van o BE guards — ghi ro de khong tuong UI la authz).
- D-F4 base58 encode 20 dong o FE (khong dep) cho signature tu vi.

## 3. Bounded spec

1. BE `guards.ts`: cookie parse thu cong tu header (khong cookie-parser) + fallback
   chain Bearer→cookie (ca AuthGuard lan OptionalAuthGuard).
2. BE `auth.controller/service`: verify tra kem Set-Cookie (passthrough res);
   `POST /api/auth/logout` (AuthGuard) xoa session + clear cookie.
3. `lib/solana.ts` (FE): base58 encode + injected provider types + connect/sign helpers.
4. `lib/api.ts`: `credentials:'include'` authed calls + `logout()` client.
5. `AuthPanel`: nut "Sign with browser wallet" + giu flows cu; logout goi BE + xoa local.
6. `AdminPanel`: `isAdmin` gate write-tabs/forms; read-only lists cho authed non-ADMIN.
7. openapi: logout path + cookie note (additive). Asserts: cookie fallback guard,
   logout xoa session, Bearer van work. Live: login→cookie→me→logout→401.

## 4. Test/agents/risks

Primary generic; gate reviewer (cookie flags, CSRF note, token fallback). Rui ro:
vi khong install (mitigate: message + fallback); Secure cookie local http (mitigate:
default off, env bat khi https).
