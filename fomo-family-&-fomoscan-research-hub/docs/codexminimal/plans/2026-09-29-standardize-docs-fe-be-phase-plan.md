# Phase Plan — Chuẩn hóa docs + FE/BE (Next.js spec + NestJS spec)

- Date: 2026-09-29
- Topic: codexminimal-standardize-docs-fe-be
- Router: task-router → project-init → repo-phase-orchestrator → native execution
- Status: executed (spec-first, compat preserved)

## Intent

User (vi): "sử dụng codex minimal bản dùng cho opencode để chuẩn hóa tài liệu + chuẩn hóa source code. đối với tài liệu cần theo chuẩn của plugin, đối với src code chia FE BE rõ ràng. đối với FE dùng nextjs specification làm tiêu chuẩn, đối với BE dùng nestjs specification làm tiêu chuẩn."

## Phase map

### Phase 0 — CodexMinimal bootstrap ✅ done
- Scope: `AGENTS.md`, `docs/ai/*`, `docs/codexminimal/*`, stack-profile dual-stack, rule-registry, protected-files.
- Verification: bootstrap scripts created 12 ai files + 3 runtime files; `AGENTS.md` renders managed blocks.
- Handoff: Phase 1.

### Phase 1 — Docs plugin-standard ✅ done
- Scope: `docs/architecture/ARCHITECTURE.md`, `DATA_FLOW.md`, `ADR-001-fe-be-split.md`, `docs/api/openapi.yaml` + `README.md`, `docs/setup/LOCAL_SETUP.md` + `ENV.md`, root `README.md` rewrite.
- Verification: manual read; `openapi.yaml` covers 7 REST + 1 SSE paths matching legacy `server.ts`.
- Handoff: Phase 2/3.

### Phase 2 — BE NestJS-spec ✅ done
- Scope: `backend/` — `main.ts`, `app.module.ts`, `config/*`, `common/*`, `server/solana.service.ts` (canonical copy), 5 modules (health, wallets, portfolio, onchain, copy-trade) each controller+service+module+dto/entity.
- Constraints: no `@nestjs/*` runtime dep (spec-first); Express-core; no logic in controllers; DTO validates writes; env via `config/` only.
- Verification: `./node_modules/.bin/tsc --noEmit -p backend/tsconfig.json` → PASS.
- Handoff: Phase 3.

### Phase 3 — FE Next.js-spec ✅ done
- Scope: `frontend/` — `app/layout.tsx` + `app/page.tsx`, `components/*` wrappers, `lib/api.ts` + `sse.ts` + `format.ts`, `hooks/*`, `types/*`, `globals.css`, `tsconfig.json`, `README.md`.
- Constraints: no `next` runtime dep (spec-first); no `backend/` imports; contract via `openapi.yaml`.
- Verification: `./node_modules/.bin/tsc --noEmit -p frontend/tsconfig.json` → PASS.
- Handoff: Phase 4.

### Phase 4 — Root wiring + verification ✅ done (this phase)
- Scope: `package.json` scripts (`dev:backend`, `dev:frontend`, `typecheck*`), root `tsconfig.json` types `+node`, `README.md`, `refactor-log.md`.
- Verification:
  - `./node_modules/.bin/tsc --noEmit` → PASS
  - `./node_modules/.bin/tsc --noEmit -p backend/tsconfig.json` → PASS
  - `./node_modules/.bin/tsc --noEmit -p frontend/tsconfig.json` → PASS
  - `npm install --legacy-peer-deps` (vite/esbuild peer conflict resolved)
  - Runtime smoke: `npm run dev:backend` boots; `curl /api/health` (to confirm in tracker).
- Stop conditions: any tsc fail → fix before Phase 5.

### Phase 5 — Index sync + runtime state (next)
- Scope: `docs/ai/*-index.md`, `context-map.json`, `docs/codexminimal/{current-work,artifact-registry,telemetry}.json`, tracker close.
- Verification: indexes list canonical paths; context-map v2 valid JSON.

## Risks / residual

- Spec-first (no `next` / `@nestjs/*` runtime): cutover steps documented in `frontend/README.md` / `backend/README.md`, not executed — intentional to protect demo.
- Legacy `src/` + `server.ts` still serve traffic; canonical `backend/src/main.ts` duplicates route wiring (drift risk) — mitigate via `openapi.yaml` + rule "legacy frozen".
- No test runner yet — first specs listed in `docs/ai/test-index.md`.
