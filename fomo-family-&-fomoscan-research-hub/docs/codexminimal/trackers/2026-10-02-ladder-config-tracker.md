# Tracker — Per-order ladder config

- Topic: ladder-config
- Intent: `docs/codexminimal/idsd/2026-10-02-ladder-config-intent.md`
- Started: 2026-10-02
- Approval: user 2026-10-02 (per-order config paper-only)

## Phases

- [x] C1 schema + DTO + executePaper persist: `done` (3 cột Int-nullable + migration + DTO ranges + persist)
- [x] C2 engine per-order + history shape: `done` (fallback constants; legs trong history; openapi execute/history fields)
- [x] C3 asserts + live + regression + review: `done` (persist + engine-config asserts GREEN; live order cfg 2500/10/150 + 400-case + tick; 10/10 asserts GREEN; root tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

Int-nullable (null = default, orders cũ y nguyên); ranges chặn 0/TP2≤TP1 ở DTO;
engine `field ?? CONSTANT`; history additive. Paper-only, không path mainnet.

## Handoff log

- 2026-10-02: intake xong (Int-nullable, ranges, fallback constants).
- 2026-10-02: C1–C3 đóng.
