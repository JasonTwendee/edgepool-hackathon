# Vận hành (Operator Guide)

> Tài liệu duy nhất để dựng và vận hành hệ thống. Người nhận repo chỉ cần:
> source + file `.env` (key thật do chủ hệ thống cấp) — không cần thêm hướng dẫn nào khác.
> Mọi URL/IP/tên máy cụ thể nằm trong `.env` và cấu hình deploy, không nằm trong tài liệu này.

## 1. Mô hình env-keys

- `backend/.env.example` và `frontend/.env.example` (được commit) là **danh mục đầy đủ**
  mọi biến môi trường. Thêm biến mới → bắt buộc khai báo vào example trước
  (CI kiểm tra tự động).
- `backend/.env` + `frontend/.env` (KHÔNG commit) chứa key thật, chỉ chủ hệ thống giữ.
- Backend đọc env duy nhất qua `backend/src/config/configuration.ts`
  (không đọc rải rác, không log object config).

| Nhóm biến BE | Ví dụ | Ghi chú |
|---|---|---|
| RPC/giá | `SOLANA_RPC_URL`, `FLUXRPC_API_KEY`, `DATASTREAM_*`, `RUGCHECK_*` | RPC key thật do chủ hệ thống cấp |
| DB | `POSTGRES_*`, `DATABASE_URL` | Mặc định local đã chạy được |
| Exec/key | `VAULT_PRIVATE_KEY`, `JITO_*` | Local-only, không bao giờ commit/log |
| Seed/auth | `ADMIN_WALLETS`, `SEED_*_PASSWORD` | Đặt trước khi public |

## 2. Chạy local (2 terminal)

Yêu cầu: Node.js ≥ 20.19, `npm` ≥ 10, Docker (cho Postgres).

```bash
cp backend/.env.example backend/.env        # điền key thật
cp frontend/.env.example frontend/.env      # optional, defaults đã đúng
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

docker compose up -d postgres               # Postgres :5433, volume fomo-postgres-data
docker inspect fomo-postgres --format='{{.State.Health.Status}}'  # healthy

# Terminal 1 — BE NestJS :3000
npm run dev:backend
# Terminal 2 — FE Next.js :3001 (proxy /api → :3000)
npm run dev:frontend
# Mở http://localhost:3001
```

BE tự migrate schema + seed dữ liệu mẫu khi DB trống.

## 3. Chạy Docker (1 lệnh, local và server giống nhau)

| Service | Port host | Ghi chú |
|---|---|---|
| `postgres` | `5433:5432` | Volume `fomo-postgres-data`, healthcheck `pg_isready` |
| `backend` | `3000:3000` (debug) | `node dist/main.js` sau `prisma migrate deploy` |
| `frontend` | `3001:3001` (public) | `next start`, rewrites `/api/*` → BE nội bộ |

```bash
docker compose up -d --build
docker compose ps                                   # chờ healthy
docker compose logs -f backend                     # xem log
docker restart <service>                           # restart 1 service
docker compose down                                # xuống nhưng GIỮ data
# CẤM: docker compose down -v (mất volume DB)
```

Single-entry production: dùng thêm overlay chặn port host của BE/FE,
chỉ public frontend qua reverse proxy (Caddy/Traefik) + TLS. Chi tiết
xem `docker-compose.prod.yml` và Caddyfile trong repo. Overlay khác:
`docker-compose.ghcr.yml` (pull-only images), `docker-compose.tune.yml`,
`docker-compose.tunnel.yml` (demo tunnel, opt-in).

## 4. Smoke (bắt buộc sau mỗi lần up/deploy)

```bash
curl -s http://localhost:3000/api/health        # BE trực tiếp
curl -s http://localhost:3001/api/health        # qua FE rewrites (bắt buộc xanh)
curl -s http://localhost:3001/api/wallets | head -c 300
curl -s "http://localhost:3001/api/portfolio/transactions?pageSize=2" | head -c 300
```

## 5. CI/CD

- **CI** (cloud): `npm ci` → `typecheck` (BE+FE) → parse openapi → kiểm tra
  env contract → chạy asserts (`assert-*.ts`, mocked) → build FE.
- **CD** (self-hosted runner trên server): checkout → đồng bộ code (giữ nguyên
  `.env` server) → append key mới từ `.env.example` (không overwrite secrets)
  → `build` + `up -d` → smoke đỏ thì fail deploy.
- Deploy thủ công: copy đúng các bước CD ở trên, đừng tự chế biến thể.
  Đổi `.env` phải `up -d <service>` (restart thường không đọc lại env).

## 6. Backup + rollback

```bash
# Backup DB trước deploy rủi ro:
docker run --rm -v fomo-postgres-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/pg-$(date +%F).tar.gz /data
# Rollback: về commit xanh gần nhất rồi up lại (giữ .env + volume).
```

## 7. Quy ước nhánh

- `main`: tích hợp + demo, luôn xanh, luôn chạy được.
- Feature branch → PR vào `main`. Không push thẳng vào `main` khi chạm code track.

## 8. Xử lý sự cố thường gặp

- **BE crash-loop `can't reach postgres`**: chờ postgres `healthy` (BE tự hồi 10–20s).
- **Migrate fail**: đọc log entrypoint, fix migration rồi `up -d --build backend`.
- **Port bận**: đổi port hoặc stop process cũ đang giữ cổng.
- **FE build OOM trên máy yếu**: build frontend riêng, tăng swap.
- **`:3001/api/health` đỏ nhưng `:3000` xanh**: sai `BACKEND_URL` (trong compose
  phải là `http://backend:3000`, không phải `localhost`).
