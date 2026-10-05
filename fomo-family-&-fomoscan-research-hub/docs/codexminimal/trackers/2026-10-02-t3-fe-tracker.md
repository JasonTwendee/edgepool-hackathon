# Tracker — T3 FE fund

- Topic: t3-fe
- Intent: `docs/codexminimal/idsd/2026-10-02-t3-fe-intent.md`
- Started: 2026-10-02

## Phases

- [x] T3.1 types + api client: `done` (`types/fund.ts` + 15 client fns + authed fetch + VaultStatusResponse mở rộng)
- [x] T3.2 DemoBanner + AuthPanel: `done` (banner tĩnh; login nonce→paste-sig→verify + paste-token dev + logout)
- [x] T3.3 AdminPanel + page wiring + VaultCard badge: `done` (5 tabs; session lift + overlay; VaultCard badge sandbox + treasury/policy note)
- [x] T3.4 tsc + build + live FE smoke + review: `done` (tsc ✅, compose build ✅, :3001 200 + banner text trong HTML + /api/health 200; reviewer APPROVE)

## Review gate — APPROVE

Token chỉ trong localStorage, không log; logout xóa; 401/403 hiện message BE nguyên văn.
Tradeoff ghi nhận: localStorage XSS-surface (chuẩn SPA demo; production → httpOnly
cookie, follow-up). Không đụng BE; không dep mới.

## Handoff log

- 2026-10-02: intake xong (paste-signature zero-dep, session lift, overlay panel).
- 2026-10-02: T3.1–T3.4 đóng.
