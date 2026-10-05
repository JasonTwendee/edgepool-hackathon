# Phase plan — T1 auto-fire engine

- Intent: `docs/codexminimal/idsd/2026-10-02-t1-autofire-intent.md`
- Tracker: `docs/codexminimal/trackers/2026-10-02-t1-autofire-tracker.md`
- Approval: user duyệt sửa `copy-trade/**` 2026-10-02 (devnet/paper-only, giữ 1-click).

## Phase map

| Phase | Nội dung | Verify |
|---|---|---|
| T1.1 | `executePaper` overrides (`vaultId`, `triggeredBy`) | asserts paper cũ vẫn GREEN |
| T1.2 | `AutoFireService` tick + loop + module wiring | `assert-autofire.ts` GREEN + `tsc` |
| T1.3 | Controller tick + openapi + `.env.example` | contract valid |
| T1.4 | Rebuild + live smoke (bot→vault→tick→history) + regression + review | 1-click intact, loop an toàn |

## T1.1 — Overrides (sửa cùng hàm, không đổi flow)

- `PaperOverrides += { vaultId?: number; triggeredBy?: string }`.
- Sizing: `this.vaults.status(overrides.vaultId ?? 1)`.
- QUATED update: `sized: { masterUsd, copyUsd, ...sizedNote, ...(triggeredBy ? { triggeredBy } : {}) }`.
- Verify: `assert-paper-executor.ts` vẫn GREEN (không đổi default path).

## T1.2 — Engine

- `auto-fire.service.ts`: `tick(windowMin=15, limit=10)` theo intent §1;
  `onModuleInit` đọc `COPY_AUTO_INTERVAL_MS` (default 300000, `0` = tắt loop);
  guard `running`.
- `copy-trade.module.ts`: providers += `AutoFireService`; imports += `AuditModule`;
  exports += `AutoFireService` (cho test/smoke sau này).
- `assert-autofire.ts` theo intent §5. `tsc` sạch.

## T1.3 — Contract

- DTO `AutoFireTickDto` (`minutes?` 1..120, `limit?` 1..20).
- `POST /api/copy-trade/auto-fire/tick` (AuthGuard+RolesGuard ADMIN,
  AuditInterceptor `@Audit('copy.auto_fire_tick')`).
- openapi: path + `AutoFireTickResult` schema (additive). `.env.example` += key.
- Sửa comment đầu `watch-signals.ts` (2 dòng: engine đã live, script còn giá trị pre-flight).

## T1.4 — Tích hợp

- `docker compose build backend + up -d backend` (migrate không đổi).
- Live (ADMIN token): tạo vault → assign ví tracked thật → tạo bot(vaultId) →
  `POST tick {minutes:60}` → `GET history` kiểm `quoteJson.sized.triggeredBy`.
  Honest-report fired/skipped.
- Regression: 1-click `POST execute` cũ + 7 asserts + smoke nhanh health/wallets/SSE.
- Review gate checklist (loop safety, dedupe, fund-safety) → đóng tracker.
- Stop: chạm ngoài `copy-trade/*`+contract+env-example → dừng hỏi (blocking rule).

## Verification commands

```bash
npx --prefix backend tsx src/modules/copy-trade/assert-autofire.ts
npx --prefix backend tsx src/modules/copy-trade/assert-paper-executor.ts
npm run typecheck
```
