# Route Index

Canonical contract: `docs/api/openapi.yaml`.

## REST

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| GET | `/api/health` | `backend/src/modules/health/health.controller.ts` → `HealthController.getHealth` | `frontend/lib/api.ts#getHealth` | RPC, `heliusEnabled`, wallet count |
| GET | `/api/wallets` | `wallets.controller.ts` → `findAll` | `api.ts#listWallets` | Tracked masters |
| POST | `/api/wallets` | `wallets.controller.ts` → `create` (`CreateWalletDto`) | `api.ts#addWallet` | PubKey validation, 400 on invalid |
| DELETE | `/api/wallets/:address` | `wallets.controller.ts` → `remove` | `api.ts#removeWallet` | 404 if unknown |
| PATCH | `/api/wallets/:address` | `wallets.controller.ts` → `updateCopyConfig` (`UpdateWalletDto`) | `api.ts#updateWalletCopy` | `isCopyEnabled`, `allocationWeight` |
| GET | `/api/portfolio/transactions` | `portfolio.controller.ts` → `getTransactions` (`PortfolioQueryDto`) | `api.ts#getPortfolioTransactions` | `?wallet=ALL\|<addr>&limit=25`, 250 total |
| POST | `/api/copy-trade/execute` | `copy-trade.controller.ts` → `execute` (`ExecuteCopyDto`) | `api.ts#executeCopyTrade` + `#executePaperTrade` | Sim default; `mode:paper`+`confirm` → devnet paper lifecycle |
| GET | `/api/copy-trade/history` | `copy-trade.controller.ts` → `history` | `api.ts#listCopyHistory` | `?wallet=&limit=`, newest first |
| POST | `/api/vaults/deposit` | `vaults.controller.ts` → `deposit` | — (BE-only, FE pending) | Queue at epoch price |
| POST | `/api/vaults/withdraw` | `vaults.controller.ts` → `withdraw` | — | Burn at settle price |
| POST | `/api/vaults/settle` | `vaults.controller.ts` → `settle` | — | Mint/burn + HWM fee |
| GET | `/api/vaults/status` | `vaults.controller.ts` → `status` | — | Vault + last epoch + queued |

## SSE

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| GET | `/api/onchain/stream` | `backend/src/modules/onchain/onchain.controller.ts` → `stream` | `frontend/lib/sse.ts`, `hooks/useOnchainStream.ts` | `CONNECTED` then `ONCHAIN_SWAP_EVENT`, 15s `: heartbeat` |

## Frontend routes (Next.js App Router spec)

| Route | File | Notes |
|---|---|---|
| `/` | `frontend/app/page.tsx` | Tab switcher: overview, vault-spec, fomo-family, fomoscan, explorer, risks |
| layout | `frontend/app/layout.tsx` | Fonts (Plus Jakarta + JetBrains Mono), dark theme, metadata |

Legacy Vite entry (`src/main.tsx` → `#root` in `index.html`) retained for compat only.
