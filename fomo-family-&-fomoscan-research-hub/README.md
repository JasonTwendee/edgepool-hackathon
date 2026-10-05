# FOMO Family & FOMOScan Research Hub

> Real-time on-chain wallet tracker + transaction intelligence (Solana Mainnet) + research dossier.
> **Stack:** BE NestJS 12 (`backend/`, `:3000`) · FE Next.js 16 App Router (`frontend/`, `:3001`) · docs chuẩn CodexMinimal.

## Quick start

```bash
cp backend/.env.example backend/.env   # điền secrets thật (không commit)
cp frontend/.env.example frontend/.env # public vars (đã đúng defaults local)
npm run dev:backend    # Terminal 1 — NestJS → http://localhost:3000
npm run dev:frontend   # Terminal 2 — Next.js → http://localhost:3001
```

| Lệnh (root orchestrator) | Mô tả |
|---|---|
| `npm run dev:backend` | BE NestJS dev (`backend/src/main.ts`) |
| `npm run dev:frontend` | FE Next.js dev (`:3001`, proxy `/api` → BE) |
| `npm run typecheck` | Typecheck BE + FE |
| `npm run build` | Build BE (`dist/`) + FE (`next build`) |
| `curl -s http://localhost:3000/api/health` | Smoke BE (hoặc `:3001/api/health` qua FE) |

## Layout

```
AGENTS.md                  Codex/OpenCode entrypoint
docs/
  ai/                      navigation layer (indexes, context-map, rules)
  architecture/            ARCHITECTURE.md, DATA_FLOW.md, ADR-001
  api/                     openapi.yaml (contract duy nhất) + README
  setup/                   LOCAL_SETUP.md, ENV.md
  codexminimal/            plans, trackers, runtime state
frontend/  (fomo-frontend) Next.js App Router runtime
  app/ layout.tsx, page.tsx · components/ data/ lib/ hooks/ types/ public/
backend/   (fomo-backend)  NestJS runtime
  src/main.ts, app.module.ts
  src/modules/{health,wallets,portfolio,onchain,copy-trade}/
  src/server/solana.service.ts + solana.module.ts (global singleton)
  src/config/ src/common/
SYSTEM_DOCUMENTATION.md    Deep spec (giữ nguyên, link từ docs/architecture/)
```

## API (tóm tắt — chi tiết `docs/api/openapi.yaml`)

- `GET /api/health` — RPC + số ví
- `GET /api/wallets` · `POST /api/wallets` · `DELETE/PATCH /api/wallets/:address`
- `GET /api/portfolio/transactions?wallet=ALL&limit=25` — 250 tx (25/ví)
- `GET /api/onchain/stream` — SSE `CONNECTED` + `ONCHAIN_SWAP_EVENT` (+ `PING` 15s)
- `POST /api/copy-trade/execute` — **simulation-only**

## Docs

- Entry AI: `AGENTS.md` → `docs/ai/project-index.md` → `docs/ai/context-map.json`
- Kiến trúc: `docs/architecture/ARCHITECTURE.md`
- API: `docs/api/README.md` + `openapi.yaml`
- Setup: `docs/setup/LOCAL_SETUP.md`
- Quy ước tsx-safe (bắt buộc cho BE): `backend/README.md`
