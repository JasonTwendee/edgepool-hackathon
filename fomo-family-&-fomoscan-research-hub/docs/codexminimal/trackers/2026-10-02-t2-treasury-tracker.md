# Tracker — T2 treasury policy

- Topic: t2-treasury
- Intent: `docs/codexminimal/idsd/2026-10-02-t2-treasury-intent.md`
- Started: 2026-10-02

## Phases

- [x] T2.1 schema + migration: `done` (4 cột Vault + 2 migrations incl. backfill reserve→0)
- [x] T2.2 service: `done` (setPolicy + lock/reserve request + fee settle + status policy/treasury)
- [x] T2.3 policy endpoint + contract + asserts: `done` (`assert-treasury.ts` GREEN:
  validation/defaults/fee/lock/reserve/legacy-compat; openapi + VaultPolicy schema)
- [x] T2.4 live smoke + regression + review: `done` (live 8/8: policy/lock-400/fee-9/
  treasury-1/audit; reviewer APPROVE)

## Review gate — APPROVE

Quyết định quan trọng giữa build: default reserve 10% phá full-withdraw legacy →
đổi default 0 opt-in + backfill rows cũ (migrations ghi rõ). Fee/lock math khớp asserts.
Không đụng copy-trade/config; envelopes giữ nguyên.

## Handoff log

- 2026-10-02: intake xong (bounded D20/reserve/fee/lock; window theo lịch để sau).
- 2026-10-02: T2.1–T2.4 đóng.
