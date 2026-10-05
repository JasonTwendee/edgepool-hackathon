# Module Index

## Backend modules (`backend/src/modules/`)

| Module | Path | Controller | Service | DTOs | Notes |
|---|---|---|---|---|---|
| Health | `backend/src/modules/health/` | `health.controller.ts` | `health.service.ts` | — | `GET /api/health`, RPC + wallet count |
| Wallets | `backend/src/modules/wallets/` | `wallets.controller.ts` | `wallets.service.ts` | `dto/create-wallet.dto.ts`, `dto/update-wallet.dto.ts` | CRUD + copy-config, PubKey validation |
| Portfolio | `backend/src/modules/portfolio/` | `portfolio.controller.ts` | `portfolio.service.ts` | `dto/portfolio-query.dto.ts` | `GET /api/portfolio/transactions`, 25/wallet |
| Onchain | `backend/src/modules/onchain/` | `onchain.controller.ts` | `onchain.service.ts` | — | `GET /api/onchain/stream` SSE |
| CopyTrade | `backend/src/modules/copy-trade/` | `copy-trade.controller.ts` | `copy-trade.service.ts` + `paper-executor.service.ts` | `dto/execute-copy.dto.ts` | Sim + devnet paper (1-click), protected |
| Market | `backend/src/modules/market/` | `market.controller.ts` | `market.service.ts` | — | Server-side ticks/prices proxy (keys off FE) |
| Vaults | `backend/src/modules/vaults/` | `vaults.controller.ts` | `vault.service.ts` | `dto/vault.dto.ts` | MoneyFi accounting (deposit/settle/withdraw/HWM-fee), off-chain v1 |
| App registry | `backend/src/app.module.ts` | — | — | — | Module wiring |
| Bootstrap | `backend/src/main.ts` | — | — | — | NestJS-spec bootstrap (Express core) |
| Chain client | `backend/src/server/solana.service.ts` | — | `SolanaOnChainListenerService` | — | Canonical listener, injectable-shaped |
| Config | `backend/src/config/` | — | — | — | `configuration.ts`, `solana.config.ts` |
| Shared | `backend/src/common/` | — | — | — | Filters, pipes, `utils/signature.util.ts` |

## Frontend areas (`frontend/`)

| Area | Path | Contents | Notes |
|---|---|---|---|
| Routes | `frontend/app/` | `layout.tsx`, `page.tsx` | App Router; tab switcher mirrors legacy `App.tsx` |
| UI | `frontend/components/` | `FomoHeader`, `FomoLeftSidebar`, `FomoRightPanel`, `FomoBottomTicker`, `TraderProfile`, `PnlChart`, `SwapsTable`, `ThesisCard` (+ legacy `WalletSidebar` unused) | DESIGN.md terminal shell, real BE data first |
| Data | `frontend/lib/` | `api.ts`, `sse.ts`, `format.ts` | Typed REST + SSE clients |
| Hooks | `frontend/hooks/` | `useOnchainStream.ts`, `usePortfolio.ts` | Stream + ledger hooks |
| Contracts | `frontend/types/` | `fomo.ts`, `onchain.ts` | Mirror BE DTOs + `openapi.yaml` |
| Styles | `frontend/globals.css` | Theme | Wraps legacy `src/index.css` |
| Config | `frontend/tsconfig.json` | Path alias `@/*` → `frontend/*` | Split typecheck |

## Legacy (deprecated)

| Area | Path | Status |
|---|---|---|
| FE legacy | `src/App.tsx`, `src/main.tsx`, `src/components/*`, `src/data/*`, `src/types/*` | Compat only, do not extend |
| BE legacy | `server.ts`, `src/server/solanaService.ts` | Compat only; canonical = `backend/` |
