# ADR-001 — Tách FE/BE rõ ràng (Next.js spec + NestJS spec)

- Date: 2026-09-29
- Status: Accepted (user-confirmed)
- Context: Repo là monolith Vite React + Express (`src/` lẫn FE/BE, `server.ts` 200 dòng route inline, không DTO, không module boundary). User yêu cầu: docs chuẩn plugin CodexMinimal, source chia FE/BE rõ ràng, FE = Next.js spec, BE = NestJS spec.

## Decision

1. `frontend/` = FE canonical, Next.js App Router spec (`app/`, `components/`, `lib/`, `hooks/`, `types/`).
2. `backend/` = BE canonical, NestJS modular spec (`src/main.ts`, `app.module.ts`, `modules/*`, `common/`, `config/`, `server/solana.service.ts`).
3. `docs/` = plugin-standard (`docs/ai/`, `docs/architecture/`, `docs/api/`, `docs/setup/`).
4. Spec-first, không big-bang: giữ `src/` + `server.ts` chạy được (`npm run dev`), đánh dấu deprecated; BE chạy Express-core với shape NestJS (controller/service/dto/module), FE giữ Vite-compat với layout App Router.
5. `docs/api/openapi.yaml` = contract duy nhất giữa FE/BE.

## Alternatives considered

- Big-bang rewrite sang `next` + `@nestjs/*` runtime ngay: loại — rủi ro gãy hackathon demo, tốn `npm install` + config lớn, chưa có test harness.
- Giữ monolith + chỉ viết lại docs: loại — không đạt yêu cầu "chia FE/BE rõ ràng".
- `apps/frontend` + `apps/backend` (Turborepo): loại — thừa tooling cho repo hiện tại; `frontend/` + `backend/` đủ rõ, ít churn import.

## Consequences

- New code chỉ vào `frontend/` hoặc `backend/`; legacy đóng băng trừ compat shim (log vào `docs/ai/refactor-log.md`).
- Cutover thật cần 2 bước: BE `npm i @nestjs/*` → `NestFactory`; FE `npm i next` → `next.config.ts` (đã ghi trong `backend/README.md` / `frontend/README.md`).
- Typecheck tách 3 tsconfig để gate từng bên.
