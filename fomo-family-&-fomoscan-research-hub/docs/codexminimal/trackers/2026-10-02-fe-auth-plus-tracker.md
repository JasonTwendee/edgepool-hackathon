# Tracker — FE auth nang cao

- Topic: fe-auth-plus
- Intent: `docs/codexminimal/idsd/2026-10-02-fe-auth-plus-intent.md`
- Started: 2026-10-02

## Phases

- [x] F1 BE cookie: `done` (extract Bearer→cookie, Set/Clear builders, verify set-cookie, logout revoke; `assert-auth` += 11 GREEN)
- [x] F2 FE wallet-sign + role guard + credentials: `done` (`lib/solana.ts` zero-dep, browser login button, `credentials:include`, logout BE, isAdmin gate writes)
- [x] F3 asserts + tsc/build + live smoke + review: `done` (cookie flow 7/7 live; 10/10 asserts GREEN; root tsc ✅; openapi 32 paths; reviewer APPROVE)

## Review gate — APPROVE

Cookie HttpOnly/Path/SameSite-Lax (+Secure opt-in); CSRF ghi follow-up production;
UI guard la UX (BE guards that); Bearer song song (scripts cu chay); token local
chi dung cho paste-token dev; logout xoa ca 2 phia. Khong dep moi, khong protected.

## Handoff log

- 2026-10-02: intake xong (zero-dep injected, dual Bearer+cookie, UI guard la UX).
- 2026-10-02: F1–F3 dong.
