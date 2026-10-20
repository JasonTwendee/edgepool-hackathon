# Project Index

## Purpose

High-level AI-readable map of this repository.

## Project Facts

- Package manager: npm (`npm install` riêng trong `backend/` và `frontend/`; root `fomo-monorepo` chỉ orchestrator)
- Framework: NestJS 12 (BE, `NestFactory`) + Next.js 16 App Router (FE, Turbopack)
- Detected stack: `@nestjs/*`, `next@16`, `react@19`, `@solana/web3.js@1`, `tailwindcss@4`
- Active profile: generic + dual-stack override (see `stack-profile.md`)
- Main app entry: `backend/src/main.ts` (BE :3000) + `frontend/app/page.tsx` (FE :3001)
- Test command: `npx tsx src/modules/**/assert-*.ts` from `backend/` (28 suites, mocked; CI runs all) — see `docs/ai/test-index.md`
- Lint command: `npm run typecheck` (root = BE + FE `tsc --noEmit -p`)
- Build command: `npm run build` (BE `tsc -p tsconfig.build.json` + FE `next build`)
- Typecheck command: `npm run typecheck`
- Smoke command: `curl -s http://localhost:3000/api/health` (BE) + `curl -s http://localhost:3001/api/health` (qua FE rewrites); prod: URL reverse-proxy do chủ hệ thống cấp (xem `docs/setup/OPERATOR.md`)
- Docker runtime: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` → `postgres` (5433) + `backend` (3000, sau `prisma migrate deploy`) + `frontend` (3001) + reverse proxy single entry. Overlays thêm: `docker-compose.ghcr.yml` (pull-only images), `docker-compose.tune.yml`. Runbook: `docs/setup/OPERATOR.md`

## Key Areas

| Area | Path | Responsibility |
|---|---|---|
| FE routes | `frontend/app/` | Pool app: `/` index, `/pools/[id]` (Calm + `?view=advanced`), `/portfolio`, `/trader`, `/terminal` (admin login wall) |
| FE UI | `frontend/components/` | 17 components: `LoginModal` (account + multi-wallet), `MyVault`, `VaultCard`, `AdminPanel`, charts/tables/ticker |
| FE data | `frontend/lib/`, `frontend/hooks/` | `api.ts` (60+ fns), `sse.ts`, `format.ts`, `solana.ts`; stream/ledger/ticker hooks |
| FE contracts | `frontend/types/` | `fund.ts` (pool/investor), `onchain.ts` mirroring BE DTOs |
| FE config | `frontend/next.config.ts`, `postcss.config.mjs`, `.env.example` | `/api` rewrites → BE, Tailwind v4, env |
| BE bootstrap | `backend/src/main.ts`, `backend/src/app.module.ts` | `NestFactory` + global ValidationPipe + CORS |
| BE config | `backend/src/config/` | Env + Solana/RPC configuration |
| BE domain | `backend/src/modules/*` | 17 modules: `health`, `wallets`, `leaderboard` (rotation), `portfolio` (pnl/holdings), `onchain` (+webhooks), `copy-trade` (auto-fire/manage/alloc/paper), `market`, `helius`, `sync`, `transactions`, `vaults` (pools/NAV), `partner`, `auth`, `users`, `audit`, `bots`, `demo` |
| BE shared | `backend/src/common/` | auth guards, fomoscan client (≥1.1s throttle), market, rugcheck, validation, live-scope/debounce/event-buffer guards |
| BE chain client | `backend/src/server/solana.service.ts` + `solana.module.ts` (@Global singleton) | RPC listener, poll loop, SSE fan-out |
| API contract | `docs/api/openapi.yaml` | REST + SSE source of truth |
| Architecture | `docs/architecture/` | System design, data-flow, ADRs |
| Setup | `docs/setup/` | Operator runbook + env (`OPERATOR.md`), demo script, launch runbook |
| AI nav | `docs/ai/` | Indexes + context-map + rules |

## Main Workflows

| Workflow | Entry Files | Notes |
|---|---|---|
| Full-stack dev (split) | `npm run dev:backend` (:3000) + `npm run dev:frontend` (:3001) | Mở http://localhost:3001 |
| BE dev (NestJS) | `backend/src/main.ts` | `npm run dev:backend` |
| FE dev (Next.js) | `frontend/app/page.tsx` | `npm run dev:frontend` (rewrites `/api` → BE) |
| Wallet tracking | `backend/src/modules/wallets/`, `leaderboard/`, `server/solana.service.ts` | Leaderboard keeps topN display rows; LIVE pipeline follows only the shared 5 pool traders (`LIVE_SCOPE_MODE=pool`); drop→deactivate |
| Portfolio ledger | `backend/src/modules/portfolio/` | DB-first + Flux/Helius backfill; FIFO realized PnL; **120d** rolling prune w/ archive |
| Realtime stream | `backend/src/modules/onchain/` | WS debounce 3s/wallet; SSE `CONNECTED` + `ONCHAIN_SWAP_EVENT`, 500ms flush, 15s heartbeat; Helius webhook ingest |
| Copy-trade engine | `backend/src/modules/copy-trade/` | Paper-only devnet: auto-fire (Qualify→1% NAV→TP1 60%), manage legs, rebalance; genesis gate |
| Pool app | `backend/src/modules/vaults/` + `partner/` + `frontend/app/{pools,portfolio,trader}/` | 1 pool = 1 vault + 1 bot + 3–5 traders; NAV MTM engine; HWM fee 75/25; deposit≥0.5 |

## Lookup Strategy

1. Read `docs/ai/context-map.json`.
2. Read this file.
3. Read relevant `docs/ai/*-index.md`.
4. Search exact indexed files.
5. Search same folder.
6. Search feature folder.
7. Search shared/common folders.
8. Search whole repository last.
