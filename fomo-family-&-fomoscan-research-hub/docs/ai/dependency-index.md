# Dependency Index

## Root (legacy compat + monorepo orchestration)

| Dep | Version | Used by |
|---|---|---|
| `react`, `react-dom` | `^19.0.1` | Legacy `src/*` + canonical `frontend/` |
| `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` | `^8.3.0`, `^4.3.3` | Legacy Vite dev/build |
| `express` | `^4.21.2` | Legacy `server.ts` + `backend/src/main.ts` core (until `@nestjs/platform-express`) |
| `@solana/web3.js` | `^1.99.0` | `src/server/solanaService.ts` → `backend/src/server/solana.service.ts` |
| `bs58` | `^6.0.0` | Signature/key helpers |
| `lucide-react`, `motion` | `^0.546.0`, `^12.23.24` | FE icons/animation |
| `@google/genai` | `^2.4.0` | Applet capability (`metadata.json`) |
| `dotenv`, `tsx`, `typescript` | `^17.2.3`, `^4.21.0` | Env + dev runner + typecheck |

## Backend canonical (`backend/`) — spec-first

- Current: `express` + `@solana/web3.js` + `dotenv` (no new runtime deps added in this pass to avoid breaking `npm install`).
- To go full NestJS runtime, install: `@nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs class-validator class-transformer`.
- `backend/README.md` lists the install command + what changes (decorators become live, `main.ts` switches to `NestFactory`).

## Frontend canonical (`frontend/`) — spec-first

- Current: `react@19` + `tailwindcss@4` (same as root; no new deps in this pass).
- To go full Next.js runtime, install: `next@15 react@19 react-dom@19` + add `next.config.ts`, migrate `vite.config.ts` usage.
- `frontend/README.md` lists the cutover steps.

## Env contract (`backend/.env.example` + `frontend/.env.example` canonical)

BE: `SOLANA_RPC_URL`, `HELIUS_API_KEY?`, `JITO_BLOCK_ENGINE_URL`, `VAULT_PRIVATE_KEY?`, `PORT`, `POSTGRES_*`, `DATABASE_URL?`. FE (public): `NEXT_PUBLIC_API_URL?`, `BACKEND_URL`.
