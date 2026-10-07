# ENV contract

BE env đã có sẵn (`backend/.env`, KHÔNG commit, KHÔNG sửa khi chưa được duyệt).
FE env tự quản (`frontend/.env`, chỉ public vars — xem `frontend/.env.example`).
Canonical examples: `backend/.env.example` (full contract incl. DB) + `frontend/.env.example`.

## Backend (`backend/.env`)

| Biến | Bắt buộc | Dùng ở | Mô tả |
|---|---|---|---|
| `SOLANA_RPC_URL` | Có (default public) | `backend/src/config/solana.config.ts` | RPC Mainnet, `confirmed` |
| `PORT` | Không (default 3000) | `backend/src/main.ts` | Cổng HTTP |
| `HELIUS_API_KEY` | Không (đã decommission 2026-10-07: Flux-only) | `health.service` | Rỗng = disabled, health báo `heliusEnabled:false`; mọi đường Helius (enrich/DAS/webhook) fail-soft khi thiếu key |
| `JITO_BLOCK_ENGINE_URL` | Không (future) | `copy-trade` | Mặc định `https://mainnet.block-engine.jito.wtf` |
| `FLUXRPC_API_KEY` | Có (thay Helius RPC) | `config` → mọi RPC reads | Key tại `fluxrpc.com/admin/apikeys`; live 02/10 |
| `FLUXRPC_REGION` | Không (default `eu`) | `config` | `eu` \| `us` |
| `DATASTREAM_API_KEY` | Không (hiện chưa cần key) | `market` (future) | Prices/candles mở không key; key dự phòng tại `/admin/fluxbeam/apikeys` |
| `RUGCHECK_API_KEY` | Không (Qualify future) | `qualify` (future) | `GET /v1/tokens/{mint}/report?key=`; live 02/10 |
| `VAULT_PRIVATE_KEY` | Không (local-only, future) | `copy-trade` | Tuyệt đối không commit, không log |
| `POSTGRES_HOST` | Không (default `localhost`) | Prisma adapter + CLI | DB host (docker: service `postgres`) |
| `POSTGRES_PORT` | Không (default `5433`) | Prisma adapter + CLI | Tránh 5434 của project api-harness |
| `POSTGRES_USER` | Không (default `fomo`) | Prisma adapter + CLI + compose | Khớp `docker-compose.yml` |
| `POSTGRES_PASSWORD` | Không (default `fomo`) | Prisma adapter + CLI + compose | Dev default; production đặt secret thật |
| `POSTGRES_DB` | Không (default `fomo_dev`) | `database` (Prisma adapter + CLI) | |
| `DATABASE_URL` | Không (default build từ `POSTGRES_*`) | Prisma CLI + runtime adapter override | Chỉ set khi muốn override full URL |
| `NODE_ENV` | Không (default `development`) | config | |

BE đọc env duy nhất qua `backend/src/config/configuration.ts` (không đọc `process.env`
rải rác; không bao giờ log object config).

## Frontend (`frontend/.env`, public — không secrets)

| Biến | Dùng ở | Mô tả |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `frontend/lib/api.ts` | Để trống = same-origin (dev qua rewrites, prod single-origin) |
| `BACKEND_URL` | `frontend/next.config.ts` | Target cho rewrites `/api/*` (default `http://localhost:3000`) |
