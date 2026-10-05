# DOCKER runbook (P1: thay PM2 bằng Compose)

Mục tiêu: 1 lệnh dựng cả stack trên Ubuntu 24/24. Demo hackathon forward FE qua Cloudflare Tunnel (P2).

## Services (P1)

| Service | Image/Build | Port host | Ghi chú |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | `5433:5432` | Volume `fomo-postgres-data`, healthcheck `pg_isready` |
| `backend` | `./backend/Dockerfile` | `3000:3000` (debug) | `node dist/main.js` sau `prisma migrate deploy`; `POSTGRES_HOST=postgres` nội bộ |
| `frontend` | `./frontend/Dockerfile` | `3001:3001` (public) | `next start -p 3001`, `BACKEND_URL=http://backend:3000` |

BE nghe `0.0.0.0:3000`, FE rewrites `/api/*` → BE nội bộ. Tunnel (P2) chỉ forward `frontend:3001`.

## Lệnh thường dùng

```bash
# Dựng / rebuild (Ubuntu + local giống nhau)
docker compose up -d --build
docker compose ps

# Logs thay pm2 logs
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f --tail=100

# Restart 1 service (thay pm2 restart)
docker restart fomo-backend

# Xuống nhưng GIỮ data
docker compose down
# NGUY HIỂM: mất hết data PG — chỉ dùng khi muốn reset máy sạch
# docker compose down -v
```

## Smoke sau khi up (bắt buộc)

```bash
curl -s http://localhost:3000/api/health        # BE trực tiếp
curl -s http://localhost:3001/api/health        # qua FE rewrites (bắt buộc xanh)
curl -s http://localhost:3001/api/wallets | head -c 300
curl -s "http://localhost:3001/api/portfolio/transactions?pageSize=2" | head -c 300
# SSE: mở http://localhost:3001 rồi kiểm tra stream CONNECTED ở console
```

Nếu `:3001/api/health` đỏ nhưng `:3000` xanh → sai `BACKEND_URL` (phải là `http://backend:3000` trong compose, không phải `localhost`).

## Env

- Live secrets ở `backend/.env` + `frontend/.env` (KHÔNG commit). Compose `environment` đã override đúng DNS nội bộ, không cần sửa `.env` khi lên Docker.
- Contract xem `backend/.env.example` + `frontend/.env.example` (`ENABLE_SYNC`, `POSTGRES_*`, `BACKEND_URL`).
- Muốn đổi pass/DB prod: set `POSTGRES_USER/PASSWORD/DB` lúc `up` (shell hoặc root `.env` untracked), compose sẽ truyền xuống cả PG lẫn BE.

## Troubleshooting

- **BE crash-loop `can't reach postgres`**: `docker compose ps` xem postgres đã `healthy` chưa; `docker compose logs postgres --tail=30`. BE có `depends_on healthy` nên thường tự hồi sau 10–20s.
- **Migrate fail**: `docker compose logs backend` sẽ dừng ở `[entrypoint] running prisma migrate deploy...` + lỗi SQL. Fix migration rồi `docker compose up -d --build backend`.
- **Port bận (5433/3000/3001)**: `ss -ltnp | grep -E '5433|3000|3001'`, đổi `POSTGRES_PORT` hoặc stop process cũ (pm2 cũ phải `pm2 delete all` trước khi chuyển hẳn sang Docker).
- **FE build OOM trên máy yếu**: `docker compose build frontend` riêng, tăng swap, hoặc build 1 lần rồi `up -d` (không `--build`).
- **Muốn single-entry chặt**: comment dòng `ports: ["3000:3000"]` của backend trong `docker-compose.yml`, smoke BE bằng `docker compose exec backend wget -qO- localhost:3000/api/health`.

## Ubuntu 24/24 checklist

- `sudo systemctl enable --now docker`
- `docker compose up -d --build && docker compose ps` (3/3 healthy)
- `sudo systemctl enable docker` + ghi chú backup volume:
  `docker run --rm -v fomo-postgres-data:/data -v $(pwd):/backup alpine tar czf /backup/pg-$(date +%F).tar.gz /data`
- Tắt pm2 cũ: `pm2 delete all && pm2 unstartup` (tránh tranh port 3000/3001).

## P2 — tunnel HACKATHON-ONLY (opt-in, mặc định không bật)

> Scope khóa theo yêu cầu: quick `trycloudflare` tunnel chỉ phục vụ demo hackathon.
> **Production setup khác hẳn** (domain riêng + TLS + reverse proxy / named tunnel + hardening + secrets management) — làm plan riêng sau hackathon, không dùng service này.

```bash
# Bật tunnel (core services phải healthy trước)
docker compose --profile tunnel up -d cloudflared

# Lấy public URL (đổi mỗi lần restart tunnel)
docker compose logs cloudflared | grep -oE "https://[a-zA-Z0-9.-]*trycloudflare\.com" | sort -u

# Smoke qua public URL (thay localhost bằng URL lấy được)
curl -s <tunnel-url>/api/health   # phải ONLINE (tunnel → FE :3001 → BE :3000)
curl -s -o /dev/null -w "%{http_code}" <tunnel-url>/   # phải 200

# Tắt tunnel khi không demo (giữ core chạy 24/24)
docker compose stop cloudflared
```

Đã verify 2026-10-01: public URL 200 cả `/` lẫn `/api/health`; `stop frontend` → tunnel trả 502, `start frontend` → 200 lại mà không cần restart tunnel.

Lưu ý: Helius webhook (`POST /api/webhooks/helius`) sẽ gãy mỗi khi URL đổi — demo thì cấu hình lại webhook theo URL mới, không dùng cho production.
