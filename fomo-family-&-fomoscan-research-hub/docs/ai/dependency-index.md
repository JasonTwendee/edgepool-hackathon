# Dependency Index

## Root (`fomo-monorepo`, orchestrator only)

`tsx` + `typescript` for typecheck orchestration. No runtime deps (Vite/Express legacy removed 2026-09-29). Lockfiles committed for reproducible CI.

## Backend (`backend/`, NestJS 12 runtime)

| Dep | Version | Used by |
|---|---|---|
| `@nestjs/common/core/platform-express` | `^12` | Runtime, DI, `@Sse`, guards/interceptors |
| `prisma` / `@prisma/client` | `^7.10` | `prisma/schema.prisma` (19 models), adapter-pg, `prisma migrate deploy` on boot |
| `@solana/web3.js` | `^1` | listener, ed25519 verify (zero-dep `node:crypto` + inline base58) |
| `reflect-metadata`, `rxjs` | — | Nest core |
| `class-validator/transformer` | — | DTO classes (+ explicit `validateDto()` under tsx) |
| `express` | `^4` | Platform adapter under Nest |

## Frontend (`frontend/`, Next.js 16 runtime)

| Dep | Version | Used by |
|---|---|---|
| `next` | `^16` | App Router (`/`, `/pools/[id]`, `/portfolio`, `/trader`, `/terminal`), rewrites `/api` → BE |
| `react` / `react-dom` | `^19` | UI |
| `tailwindcss` + `@tailwindcss/postcss` | `^4` | Styling |
| `lucide-react` | — | Icons |

## Env contract (`backend/.env.example` + `frontend/.env.example` canonical)

- BE runtime: `SOLANA_RPC_URL`, `PORT`, `HELIUS_API_KEY?`, `FLUXRPC_API_KEY/REGION`, `DATASTREAM_API_KEY/BASE_URL`, `RUGCHECK_API_KEY/STRICT`, `FOMOSCAN_API_KEY/BASE_URL/PNL_PRIMARY`, `LEADERBOARD_TOP_N/CAP/PERIOD/SYNC_INTERVAL_MS`, `COPY_TRADE_PAPER_ENABLED/MAX_USD`, `COPY_MIN_MCAP_USD`, `DEVNET_RPC_URL`, `COPY_AUTO/MANAGE/ALLOC_INTERVAL_MS`, `AUTO_FIRE_WINDOW_MAX_MIN`, `SYNC_INTERVAL_MS`, `FULL_HISTORY_DAYS`, `LANTERN_URL`, `JITO_BLOCK_ENGINE_URL`, `VAULT_PRIVATE_KEY?`, `POSTGRES_*/DATABASE_URL`, `ENABLE_SYNC`, `COOKIE_SECURE`, `ADMIN_WALLETS`, `SEED_*` (9 seeded accounts), `PRUNE_ARCHIVE_DIR`.
- FE public only: `NEXT_PUBLIC_API_URL` (empty = same-origin), `BACKEND_URL`.
- Rule: every `process.env.X` read must exist in the matching example (CI `check-env-contract.sh`).
