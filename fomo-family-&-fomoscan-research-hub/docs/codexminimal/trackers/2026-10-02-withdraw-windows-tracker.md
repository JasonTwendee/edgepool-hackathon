# Tracker — Withdrawal windows

- Topic: withdraw-windows
- Intent: `docs/codexminimal/idsd/2026-10-02-withdraw-windows-intent.md`
- Started: 2026-10-02

## Phases

- [x] W1 schema + migration: `done` (2 cột Vault + migration)
- [x] W2 service gate + status + policy extend: `done` (windowState pure + settle gate + status.window + policy pair-validation)
- [x] W3 contract + asserts + live + regression + review: `done` (`assert-windows.ts` GREEN 5 nhóm; live 6/6; 11/11 asserts GREEN; root tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

Neo createdAt (không cron, deterministic); chỉ gate settle (request vẫn queue);
opt-in default 0 (vault cũ y nguyên); 400 kèm nextOpensAt; pair-validation chặn
nửa cấu hình. Không đụng protected; envelopes giữ nguyên.

## Handoff log

- 2026-10-02: intake xong (neo createdAt, chi gate settle, opt-in).
- 2026-10-02: W1–W3 đóng. Smoke phát hiện reason DTO MinLength(3) (smoke dùng 'w' → policy không apply — test, không phải bug BE).
