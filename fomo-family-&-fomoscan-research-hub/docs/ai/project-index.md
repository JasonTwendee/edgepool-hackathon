# Project Index

## Purpose

High-level AI-readable map of this repository.

## Project Facts

- Package manager: npm (`npm install` riêng trong `backend/` và `frontend/`; root `fomo-monorepo` chỉ orchestrator)
- Framework: NestJS 12 (BE, `NestFactory`) + Next.js 16 App Router (FE, Turbopack)
- Detected stack: `@nestjs/*`, `next@16`, `react@19`, `@solana/web3.js@1`, `tailwindcss@4`
- Active profile: generic + dual-stack override (see `stack-profile.md`)
- Main app entry: `backend/src/main.ts` (BE :3000) + `frontend/app/page.tsx` (FE :3001)
- Test command: none yet (add `*.spec.ts` under `backend/`)
- Lint command: `npm run typecheck` (root = BE + FE `tsc --noEmit -p`)
- Build command: `npm run build` (BE `tsc -p tsconfig.build.json` + FE `next build`)
- Typecheck command: `npm run typecheck`
- Smoke command: `curl -s http://localhost:3000/api/health` (BE) + `curl -s http://localhost:3001/api/health` (qua FE rewrites)
- Docker runtime (2026-10-01, thay PM2): `docker compose up -d --build` → `postgres` (5433) + `backend` (3000, `node dist/main.js` sau `prisma migrate deploy`) + `frontend` (3001, `next start`); hackathon-only opt-in `cloudflared` via `--profile tunnel`. Runbook: `docs/setup/DOCKER.md`

## Key Areas

| Area | Path | Responsibility |
|---|---|---|
| FE routes | `frontend/app/` | Next.js App Router pages (`layout.tsx` with Metadata API, `page.tsx` tab router) |
| FE UI | `frontend/components/` | 9 presentational sections (materialized from legacy `src/`, real code) |
| FE data | `frontend/data/`, `frontend/lib/`, `frontend/hooks/` | Demo content, REST/SSE clients, formatting, stream hooks |
| FE contracts | `frontend/types/` | `fomo.ts`, `onchain.ts` mirroring BE DTOs |
| FE config | `frontend/next.config.ts`, `postcss.config.mjs`, `.env.example` | `/api` rewrites → BE, Tailwind v4, env |
| BE bootstrap | `backend/src/main.ts`, `backend/src/app.module.ts` | `NestFactory` + global ValidationPipe + CORS |
| BE config | `backend/src/config/` | Env + Solana/RPC configuration |
| BE domain | `backend/src/modules/*` | `health`, `wallets`, `portfolio`, `onchain` (`@Sse`), `copy-trade` (controller+service+dto) |
| BE shared | `backend/src/common/` | `validation/validate-dto.ts`, `utils/signature.util.ts` |
| BE chain client | `backend/src/server/solana.service.ts` + `solana.module.ts` (@Global singleton) | RPC listener, poll loop, SSE fan-out |
| API contract | `docs/api/openapi.yaml` | REST + SSE source of truth |
| Architecture | `docs/architecture/` | System design, data-flow, ADRs |
| Setup | `docs/setup/` | Local runbook + env; CI/CD + deploy server SSOT: `docs/setup/CICD_SERVER.md` |
| AI nav | `docs/ai/` | Indexes + context-map + rules |

## Main Workflows

| Workflow | Entry Files | Notes |
|---|---|---|
| Full-stack dev (split) | `npm run dev:backend` (:3000) + `npm run dev:frontend` (:3001) | Mở http://localhost:3001 |
| BE dev (NestJS) | `backend/src/main.ts` | `npm run dev:backend` |
| FE dev (Next.js) | `frontend/app/page.tsx` | `npm run dev:frontend` (rewrites `/api` → BE) |
| Wallet tracking | `backend/src/modules/wallets/`, `backend/src/server/solana.service.ts` | CRUD + `Map` store + PubKey validation |
| Portfolio ledger | `backend/src/modules/portfolio/` | 25 tx/wallet, 250 total, `slot` desc sort |
| Realtime stream | `backend/src/modules/onchain/` | SSE `CONNECTED` + `ONCHAIN_SWAP_EVENT`, 15s heartbeat |
| Copy-trade sim | `backend/src/modules/copy-trade/` | Simulation only, no fund movement |

## Lookup Strategy

1. Read `docs/ai/context-map.json`.
2. Read this file.
3. Read relevant `docs/ai/*-index.md`.
4. Search exact indexed files.
5. Search same folder.
6. Search feature folder.
7. Search shared/common folders.
8. Search whole repository last.
