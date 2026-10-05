# Tracker — ATR stop + TP regime

- Topic: atr-regime
- Intent: `docs/codexminimal/idsd/2026-10-02-atr-regime-intent.md`
- Started: 2026-10-02
- Approval: user 2026-10-02 (ATR core paper-only)

## Phases

- [x] R1 suggestRegime + DTO + executePaper tune: `done` (regime RR 1:2 + autoTune flag + per-field explicit-wins + fail-open fallback)
- [x] R2 asserts + contract: `done` (regime matrix calm/normal/wild/fallback + tune/explicit/off cases; openapi autoTune)
- [x] R3 live + regression + review: `done` (live CONFIRMED + explicit-wins + manage tick; 11/11 asserts GREEN; root tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

RR 1:2 neo ATR-stop (giai thich duoc); tune-once luc fire (khong drift); explicit
luon thang; fallback bao toan hanh vi cu; manage khong can doi (doc order fields).
Paper-only, khong path mainnet.

## Known limitation (honest)

Live tune chua kich hoat: DataStream keyless chi tra 2 nen 1h (can 15+ cho ATR-14)
→ moi live order roi vao fallback + note. Can tier keyed hoac lich su sau hon de
tune that; matrix day du trong asserts. Multi-timeframe ATR (1m) la follow-up.

## Handoff log

- 2026-10-02: intake xong (RR 1:2, explicit-wins, tune-once).
- 2026-10-02: R1–R3 dong.
