# API — contract guide

Canonical: `openapi.yaml` (OpenAPI 3.0.3). Mọi thay đổi REST/SSE phải sửa `openapi.yaml` trước, rồi mới sửa BE DTO + FE client.

## Endpoints

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái + RPC + số ví |
| GET | `/api/wallets` | Danh sách ví tracking |
| POST | `/api/wallets` | Thêm ví (validate PubKey) |
| DELETE | `/api/wallets/:address` | Gỡ ví |
| PATCH | `/api/wallets/:address` | Cập nhật copy-config |
| GET | `/api/portfolio/transactions?wallet=ALL&limit=25` | Ledger 250 tx (25/ví) |
| GET | `/api/onchain/stream` | SSE realtime (`CONNECTED` + `ONCHAIN_SWAP_EVENT`, 15s `PING`; Nest prefix dòng `id:`) |
| GET | `/api/onchain/events?wallet=ALL&limit=20` | Feed events đã persist (DB `realtime_events`, mới nhất trước) |
| POST | `/api/copy-trade/execute` | Sim-only, không move fund |

## BE mapping (NestJS runtime)

- `backend/src/modules/health/health.controller.ts`
- `backend/src/modules/wallets/{wallets.controller.ts,dto/*.dto.ts}`
- `backend/src/modules/portfolio/{portfolio.controller.ts,dto/portfolio-query.dto.ts}`
- `backend/src/modules/onchain/onchain.controller.ts` (`@Sse`, Observable; heartbeat = `PING` data message vì Nest SSE không ghi comment `: heartbeat`)
- `backend/src/modules/copy-trade/{copy-trade.controller.ts,dto/execute-copy.dto.ts}`

## FE mapping (Next.js-spec)

- `frontend/lib/api.ts`: `getHealth, listWallets, addWallet, removeWallet, updateWalletCopy, getPortfolioTransactions, executeCopyTrade, listRealtimeEvents`.
- `frontend/lib/sse.ts` + `frontend/hooks/useOnchainStream.ts`: subscribe SSE (live); `realtime_events` là bản persist của cùng feed.

## Smoke

```bash
curl -s http://localhost:3000/api/health
curl -s "http://localhost:3000/api/portfolio/transactions?limit=2" | head -c 600
curl -N -s http://localhost:3000/api/onchain/stream | head -n 5
```
