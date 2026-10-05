# Tracker — T1-B2 manage auto-close

- Topic: t1b2-manage
- Intent: `docs/codexminimal/idsd/2026-10-02-t1b2-manage-intent.md`
- Started: 2026-10-02
- Approval: user 2026-10-02 (auto-close paper, audit đầy đủ)

## Phases

- [x] B2.1 ManageService + wiring: `done` (promote v1 math, TIME_STOP 24h, loop + guard)
- [x] B2.2 tick endpoint + contract + asserts: `done` (`assert-manage.ts` GREEN 10 cases;
  openapi 31 paths valid; `.env.example` loop key)
- [x] B2.3 live smoke + regression + review: `done` (live tick: scanned 3, holds 3,
  0 premature closes; anon 401; 10/10 asserts GREEN; root tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

Cùng công thức v1 đã review (không phát minh lại); full-close-only (paper legs là
hư cấu); idempotent (chỉ quét closedAt null); UNKNOWN không đụng row; exit price +
realized ghi显式 để đối chiếu; audit actor manage. Paper-only, không path mainnet.

## Handoff log

- 2026-10-02: intake xong (promote v1, full-close-only, TIME_STOP 24h).
- 2026-10-02: B2.1–B2.3 đóng.
