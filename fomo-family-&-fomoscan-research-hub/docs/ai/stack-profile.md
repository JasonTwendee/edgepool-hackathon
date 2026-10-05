# Stack Profile

Source of truth for stack-specific assumptions used by CodexMinimal.

## Active Profile

- `generic` (harness default) + explicit dual-stack conventions below (user-confirmed 2026-09-29).
- FE canonical: Next.js App Router specification (`frontend/`).
- BE canonical: NestJS modular specification (`backend/`).

## Generic-First Rule

- Detection evidence is not profile activation.
- Keep `generic` active until the user explicitly selects a supported profile or a bundled profile can be justified from repo evidence.
- Dual-stack override below is an explicit user instruction, not auto-detection.

## Detection Evidence

- `backend/package.json`: `@nestjs/common/core/platform-express@12`, `reflect-metadata`, `rxjs`, `class-validator/transformer`, `@solana/web3.js`, `express@4`, `tsx` — NestJS runtime thật (`NestFactory`, `OnModuleInit` poll).
- `frontend/package.json`: `next@16`, `react/react-dom@19`, `lucide-react`, `tailwindcss@4` + `@tailwindcss/postcss` — Next.js App Router runtime thật (`next dev -p 3001`, `next build` xanh).
- Root `fomo-monorepo` (private): orchestrator scripts (`dev:backend`, `dev:frontend`, `typecheck`, `build`), không còn deps Vite/Express/React.
- `tsconfig.json` (root) + `backend/tsconfig.json` (+`tsconfig.build.json`) + `frontend/tsconfig.json` — monorepo typecheck split.

## Detected But Generic

- (none — cả hai runtime deps đã hiện diện; profile vẫn `generic` theo harness rule.)

## Allowed Profile Skills

- BE (NestJS conventions): `nestjs-tdd-builder`, `nestjs-bug-fixer`, `nestjs-code-reviewer`, `nestjs-refactor-guardian`.
- FE (Next.js conventions): no `nestjs-*` skills; use generic + `repo-phase-orchestrator` + `project-indexer`.
- Cross-cutting: `idsd-orchestrator`, `repo-phase-orchestrator`, `project-indexer`, `project-init`, `task-router`.

## Profile-Specific Rules

- BE: modules own controller + service + dto; no cross-module deep imports; shared code via `src/common/`; chain singleton via global `SolanaModule`; body validation via explicit `validateDto()` (+ global pipe là lớp 2); query parse thủ công; config via `src/config/` (never hardcode RPC URL); DI luôn `@Inject()`显式 vì tsx không emit metadata.
- FE: App Router only (`app/` = routes); `components/` presentational; `lib/` data-fetch + solana client; `types/` shared contracts mirroring BE DTOs; no direct `backend/` imports; API base same-origin qua `next.config.ts` rewrites.
- API contract: `docs/api/openapi.yaml` is source of truth; BE DTOs and FE `lib/api.ts` must match it (error envelope `{success:false,message}` giữ nguyên trên mọi 4xx/5xx có chủ đích).

## Overrides

- User 2026-09-29: "tài liệu theo chuẩn plugin, src chia FE/BE rõ ràng, FE dùng Next.js spec, BE dùng NestJS spec" — recorded as durable override.
- User 2026-09-29 (pass 2): refactor BE Express → NestJS runtime thật; `npm install` riêng cho FE và BE; xóa `src/` cũ giữ lại thông tin cần thiết cho `frontend/` + `backend/` mới.
