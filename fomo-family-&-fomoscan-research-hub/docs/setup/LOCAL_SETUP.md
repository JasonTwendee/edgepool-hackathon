# Local Setup

## 1. Yêu cầu

- Node.js ≥ 20.19, `npm` ≥ 10.
- Không cần RPC key để chạy (fallback deterministic ledger vẫn đủ 250 tx;
  RPC public thỉnh thoảng 429 nhưng BE tự bù đủ dữ liệu).

## 2. Env

```bash
cp backend/.env.example backend/.env          # điền secrets thật (không commit)
cp frontend/.env.example frontend/.env        # optional (defaults đã đúng cho local)
```

Xem `docs/setup/ENV.md` cho từng biến.

## 3. Install (FE và BE riêng)

```bash
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
# root (optional, chỉ orchestrator scripts): npm install --legacy-peer-deps
```

## 4. Database — Postgres qua Docker

```bash
docker compose up -d postgres   # fomo-postgres :5433, volume fomo-postgres-data
docker inspect fomo-postgres --format='{{.State.Health.Status}}'  # healthy
```

BE tự migrate schema (`prisma migrate dev`) + seed 10 ví master khi bảng rỗng.
Không đụng container `api-harness-postgres-1` của project khác (nó dùng port 5434).

## 4. Chạy split FE/BE (2 terminal)

```bash
# Terminal 1 — BE NestJS :3000
npm run dev:backend
# Terminal 2 — FE Next.js :3001 (proxy /api → :3000)
npm run dev:frontend
# Mở http://localhost:3001
```

## 5. Smoke

```bash
curl -s http://localhost:3000/api/health
curl -s "http://localhost:3000/api/portfolio/transactions?limit=2" | head -c 600
curl -N -s http://localhost:3000/api/onchain/stream | head -n 5
# qua FE rewrite (BE phải đang chạy):
curl -s http://localhost:3001/api/health
```

## 6. Typecheck / build

```bash
npm run typecheck            # BE + FE
npm --prefix frontend run build   # next build
```
