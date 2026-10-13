# Rule Registry

Source of persisted durable rules for CodexMinimal.

AGENTS.md is the operational rendered view.
This file is the durable rule source.

## Protected Paths

- See `docs/ai/protected-files.md` for critical / sensitive / integration lists.

## Generic Workflow Rules

- Use the smallest suitable skill.
- Route new features through intake before execution.
- Read indexes before broad repository search.
- Keep runtime state aligned with the active plan and tracker.
- Write repeated user-confirmed feedback directly into `Promoted Feedback Rules` below. No separate ledger, strikes, or thresholds.

## Generic Testing Rules

- Run targeted verification before broader checks.
- Keep generated build artifacts out of commits unless explicitly required.
- Typecheck split: `npm run typecheck` (root orchestrator) = BE `tsc -p backend/tsconfig.json` + FE `tsc -p frontend/tsconfig.json`.
- Runtime gates: BE boot smoke (`/api/health`, wallets CRUD incl. 400/404 envelopes, portfolio totals, SSE `CONNECTED`), FE `next build`, split smoke FE:3001 → BE:3000 qua rewrites.

## Active Profile

- See `docs/ai/stack-profile.md` for the current stack profile and allowed profile-specific skills.

## Profile-Specific Rules

### Documentation (plugin-standard)

- `docs/ai/` = AI navigation layer (indexes + context-map + rules). Update after every structural change.
- `docs/architecture/` = system design, ADRs, data-flow.
- `docs/api/` = REST/SSE contract (`openapi.yaml` canonical).
- `docs/setup/` = local env + runbook.
- Root `README.md` = 1-page entry; `SYSTEM_DOCUMENTATION.md` = deep spec (kept, linked from `docs/architecture/`).

### Backend (NestJS runtime)

- Layout: `backend/src/main.ts`, `app.module.ts`, `server/solana.module.ts` (global singleton), `modules/<domain>/{*.controller.ts,*.service.ts,*.module.ts,dto/*.dto.ts}`, `common/`, `config/`.
- Naming: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.dto.ts`, `*.spec.ts`.
- Controllers = thin HTTP/SSE mapping only; business logic in services.
- **tsx-safe DI (bắt buộc): `@Inject(Token)`显式 cho MỌI constructor** — tsx/esbuild không emit decorator metadata nên shorthand `private readonly x: T` nhận `undefined` lúc runtime (tsc vẫn xanh, lỗi chỉ lộ khi boot).
- **tsx-safe validation (bắt buộc): body qua `validateDto(DtoClass, body)`显式 trong controller; query parse thủ công** — global `ValidationPipe` không infer được `@Query/@Body` type dưới tsx (đã gây `perWalletLimit` string + mất default).
- Error envelope `{success:false,message}` giữ nguyên qua `HttpException({success:false,…})` — không để lọt shape Nest mặc định.
- Chain listener singleton duy nhất qua `SolanaModule` global; không provide per-module.
- No cross-module service deep-imports; share via `common/`.

### Frontend (Next.js runtime)

- Layout: `frontend/app/{layout.tsx,page.tsx}`, `frontend/components/`, `frontend/data/`, `frontend/lib/`, `frontend/hooks/`, `frontend/types/`, `frontend/public/`.
- `app/` owns routing only; reusable UI in `components/`; fetch + solana helpers in `lib/`; shared shapes in `types/`.
- FE never imports from `backend/`; contract via `docs/api/openapi.yaml` + `frontend/lib/api.ts` (same-origin base, dev qua `next.config.ts` rewrites → `BACKEND_URL`).
- Styling: Tailwind CSS v4 (`@tailwindcss/postcss`); fonts bằng CSS `@import` trong `globals.css`.

## Safety Rules

- Do not commit `.env` or secrets.
- Do not edit protected files without explicit approval.
- Legacy `src/` + `server.ts` + `vite.config.ts` + `index.html`: REMOVED 2026-09-29 (backup `/tmp/opencode/legacy-backup-20260929.tar.gz`); không còn compat layer.

## Promoted Feedback Rules

<!-- CODEXMINIMAL:PROMOTED_FEEDBACK_RULES START -->
- 2026-09-29 (user-confirmed): Docs follow CodexMinimal plugin standard; source split FE/BE clearly; FE = Next.js spec; BE = NestJS spec.
- 2026-09-29 (user-confirmed pass 2): BE = NestJS runtime thật (không Express thủ công); FE/BE `npm install` riêng; xóa `src/` cũ, giữ thông tin cần thiết cho source mới.
- 2026-10-02: KHÔNG BAO GIỜ sửa migration đã apply — backfill/data-fix luôn bằng migration mới (Prisma checksum drift).
- 2026-10-06 (user-confirmed): Deploy + CI/CD ghi vào 1 file SSOT `docs/setup/CICD_SERVER.md`; session mới đọc file này trước, không đoán lệnh.
- 2026-10-06: Structural change (module/route/entity/suite mới) → update `docs/ai` indexes + `context-map.json` ngay trong cùng commit.
- 2026-10-07 (user-confirmed): KOL /trader chỉ giữ Fees + Share + Signals + Payouts (+ xem/request trader); mọi pool ops (settings/rules/pause/remove/basket) là ADMIN-only ở /terminal, khóa cả BE (controller Roles + service guard).
- 2026-10-12 (user-confirmed, SUPERSEDES 2026-10-07): Owner model — KOL toàn quyền trên partner pool của mình (pause/resume kể cả sau kill-switch, listing, tên, slots, maxTraders, add/remove trader, rules); ADMIN giữ fees/settle/applications/rotation. Loss-based gates (kill-switch halt, deposit gate) vẫn chặn entries cho đến khi hồi phục dù status đã resume. /trader render full design mới nhưng không nút ghi nào vượt qua BE assertOwner.
- 2026-10-12 (user-directed, SUPERSEDES manual-settle): nạp/rút của user tự settle ngay ở giá MTM hiện tại (controller gọi settleEpoch sau khi booking; window đóng hoặc lỗi settle → giữ QUEUED như cũ). Settle là tính toán đơn định (giá + mint + HWM ratchet), không cần người duyệt. Endpoint settle tay của ADMIN giữ lại cho override/explicit-NAV. Tiền deposit vào NAV ngay trong cùng epoch (không pha loãng holder); tiền rút ra trừ khỏi NAV đã ghi epoch (không thổi giá cho người ở lại, không sinh fee ma).
- 2026-10-12: Tracked-wallet copy-config (PATCH /api/wallets/:address, gồm deactivate/reactivate) là ADMIN-only (guard + audit); deactivation chỉ dừng ingest (sync + WS unwatch), history giữ lại cho rotation. Pool detail (`GET /api/vaults/:id/pool`) luôn gửi bearer khi có session để myHolding/position hiển thị số thật; ẩn danh vẫn thấy public fields như cũ.
<!-- CODEXMINIMAL:PROMOTED_FEEDBACK_RULES END -->

## User Overrides

- 2026-09-29: FE canonical = `frontend/` (Next.js App Router); BE canonical = `backend/` (NestJS modular runtime); legacy đã xóa (pass 2).
