# Tracker — Demo Simulator

- Topic: demo-sim
- Intent: `docs/codexminimal/idsd/2026-10-02-demo-sim-intent.md`
- Started: 2026-10-02

## Phases

- [x] M1 demo service: `done` (seed/replay/reset/performance + simulated executor + TIME force-close + pending withdraw)
- [x] M2 endpoints + contract: `done` (4 endpoints ADMIN+Audit + openapi 37 paths + schemas)
- [x] M3 asserts + live + regression + review: `done` (`assert-demo.ts` GREEN 7 nhóm; live full story 6/6; 13/13 asserts GREEN; root tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

0 sửa protected code (chỉ gọi services); ledger thật nguyên vẹn (mark `demo:` + prefix);
simulated executor đúng bản chất (không đốt dust); reset giữ audit; withdraw dừng
QUEUED + notification đúng yêu cầu; manual-only (không loop ngầm).

## Known limitation (honest)

Replay PnL phẳng khi mint cũ mất giá live (scratch 0) — story vẫn đầy đủ flow;
muốn PnL nhảy thì replay signals gần (days nhỏ) hoặc tier giá sâu hơn.

## Handoff log

- 2026-10-02: intake xong (simulated executor, force-close TIME, reset giữ audit, manual-only).
- 2026-10-02: M1–M3 đóng.
