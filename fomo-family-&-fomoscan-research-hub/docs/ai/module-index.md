# Module Index

## Backend modules (`backend/src/modules/`)

| Module | Path | Controller | Service | DTOs | Notes |
|---|---|---|---|---|---|
| Health | `backend/src/modules/health/` | `health.controller.ts` | `health.service.ts` | — | `GET /api/health`, RPC + wallet count, secrets masked |
| Wallets | `backend/src/modules/wallets/` | `wallets.controller.ts` | `wallets.service.ts` | `dto/update-wallet.dto.ts` | List/PATCH copy-config/enrich; universe owned by rotation (no manual POST) |
| Leaderboard | `backend/src/modules/leaderboard/` | `leaderboard.controller.ts` (`api/wallets/rotation`) | `leaderboard.service.ts` | — | FomoScan rotation topN=30 cap=50 Solana-only; drop→deactivate keep history |
| Portfolio | `backend/src/modules/portfolio/` | `portfolio.controller.ts` | `portfolio.service.ts` + `pnl.service.ts` + `holdings.service.ts` | `dto/portfolio-query.dto.ts` | txns/pnl/overview/holdings/fomoscan; FIFO realized PnL |
| Onchain | `backend/src/modules/onchain/` | `onchain.controller.ts` + `webhooks.controller.ts` | `onchain.service.ts` | — | `GET /api/onchain/stream` SSE + `GET /events`; Helius webhook ingest |
| CopyTrade | `backend/src/modules/copy-trade/` | `copy-trade.controller.ts` | `copy-trade.service.ts` + `auto-fire.service.ts` + `manage.service.ts` + `allocation.service.ts` + `paper-executor.service.ts` | `dto/execute-copy.dto.ts`, `dto/auto-fire-tick.dto.ts`, `dto/manage-tick.dto.ts`, `dto/rebalance.dto.ts` | Execute/history + auto-fire (5m) + manage exits (TP1/TP2/stop/trail/time legs) + rebalance; devnet-only executor (genesis gate) |
| Market | `backend/src/modules/market/` | `market.controller.ts` | `market.service.ts` | — | Server-side ticks/prices proxy (keys off FE): CoinGecko + DataStream |
| Helius | `backend/src/modules/helius/` | — (no controller) | `helius.service.ts` + `enrich.service.ts` | — | History backfill + DAS enrich services |
| Sync | `backend/src/modules/sync/` | — (no controller) | `sync.service.ts` + `history-sync.service.ts` | — | 60s full-sync + backfill; prune 35d w/ archive |
| Transactions | `backend/src/modules/transactions/` | — (no controller) | `transactions.service.ts` | — | DB-first ledger service |
| Vaults | `backend/src/modules/vaults/` | `vaults.controller.ts` | `vault.service.ts` | `dto/vault.dto.ts` | Pool accounting: pools/list/detail(`advanced`)/mine/overview/earnings, deposit≥0.5/settle/withdraw+cancel, HWM fee 75/25, NAV engine MTM |
| Partner | `backend/src/modules/partner/` | `partner.controller.ts` | `partner.service.ts` | `dto/partner.dto.ts` | Trader portal: apply/me/claim(verified wallet)/settings/traders/signals/payouts/review |
| Auth | `backend/src/modules/auth/` | `auth.controller.ts` | `auth.service.ts` | `dto/auth.dto.ts` | Wallet nonce/verify + username+scrypt login/logout/purge; sha256 sessions, httpOnly cookie |
| Users | `backend/src/modules/users/` | `users.controller.ts` | `users.service.ts` | `dto/users.dto.ts` | ADMIN list + setRole by username |
| Audit | `backend/src/modules/audit/` | `audit.controller.ts` | `audit.service.ts` | — | Append-only incl. `auth.login_failed`; `@Audit()` interceptor |
| Bots | `backend/src/modules/bots/` | `bots.controller.ts` | `bots.service.ts` | `dto/bots.dto.ts` | 1 pool = 1 vault + 1 AUTO bot; mode AUTO/PAUSED |
| Demo | `backend/src/modules/demo/` | `demo.controller.ts` | `demo.service.ts` | `dto/demo.dto.ts` | seed/replay/reset + bot performance (ADMIN) |
| App registry | `backend/src/app.module.ts` | — | — | — | Module wiring (controllers with `@Audit()` must import `AuditModule`) |
| Bootstrap | `backend/src/main.ts` | — | — | — | NestFactory Express core, ValidationPipe, CORS |
| Chain client | `backend/src/server/solana.service.ts` + `solana.module.ts` (@Global) | — | `SolanaOnChainListenerService` | — | Canonical listener singleton; poll tracked actives |
| Config | `backend/src/config/` | — | — | — | `configuration.ts` (sole env reader), `solana.config.ts` (mask helper) |
| Shared | `backend/src/common/` | — | — | — | auth guards, fomoscan client (≥1.1s throttle), market, rugcheck, validation |
| DB layer | `backend/src/database/` + `backend/prisma/` | — | PrismaService (global) | — | Prisma 7 adapter-pg; NEVER edit applied migration |

## Frontend areas (`frontend/`)

| Area | Path | Contents | Notes |
|---|---|---|---|
| Routes | `frontend/app/` | `/` pools index, `/pools/[id]` (Calm + `?view=advanced`), `/portfolio`, `/trader`, `/terminal` | Pool app is main surface; terminal admin-only login wall |
| UI | `frontend/components/` | `LoginModal` (account + Phantom/OKX/Solflare), `MyVault`, `VaultCard`, `AdminPanel`, `PnlChart`, `SwapsTable`, `FomoHeader`, `FomoLeftSidebar`, `FomoRightPanel`, `FomoBottomTicker`, `NotificationsBell`, `TraderProfile`, `ThesisCard`, `CopyHistory`, `CopyConfirmModal`, `WalletAvatar`, `DemoBanner` | All-English UI; no public register route |
| Data | `frontend/lib/` | `api.ts` (60+ fns), `sse.ts`, `format.ts`, `solana.ts` | Typed REST + SSE clients, same-origin via rewrites |
| Hooks | `frontend/hooks/` | `useOnchainStream.ts`, `usePortfolio.ts`, `useMarketTicker.ts` | Stream + ledger + ticker hooks |
| Contracts | `frontend/types/` | `fund.ts`, `onchain.ts` | Mirror BE DTOs + `openapi.yaml` |
| Config | `frontend/next.config.ts`, `postcss.config.mjs`, `.env.example` | Rewrites `/api` → `BACKEND_URL`, Tailwind v4 | `NEXT_PUBLIC_API_URL=""` = same-origin |

## Legacy (removed 2026-09-29)

`src/`, `server.ts`, `vite.config.ts`, `index.html` deleted (backup `/tmp/opencode/legacy-backup-20260929.tar.gz`). No compat layer remains.
