# Tracker — Pass 3: TypeORM → Prisma 7 + FE env

- Topic: prisma-migration-fe-env
- Started/Closed: 2026-09-29
- Env: BE `backend/.env` có sẵn (KHÔNG đụng); FE `.env` tạo từ example (public only).

## Docker hiện tại (check đầu pass)

- Docker 29.7.2 + Compose v5.5.0 sẵn sàng.
- Project khác đang chạy: `api-harness-postgres-1` (:5434) + redis + mcp-atlassian →
  quyết định: compose riêng `fomo-postgres` :5433, volume + network riêng, không đụng.

## Thay đổi

- `docker-compose.yml` (đã có từ pass trước, giữ nguyên): postgres:17-alpine, :5433, healthcheck.
- `backend/prisma/schema.prisma` (model `TrackedWallet` → `tracked_wallets`, 1:1 với bảng TypeORM cũ) + `prisma.config.ts` (DB-url build từ `POSTGRES_*`, `DATABASE_URL` override) + `prisma/migrations/20260929084431_init/`.
- `src/database/prisma.service.ts` (adapter-pg, `$connect/$disconnect`) + `prisma.module.ts` (global); xóa `database.module.ts` (TypeORM).
- `wallets.service.ts` → Prisma CRUD (count/createMany/upsert/deleteMany/findUnique+update), seed khi rỗng, sync listener Map; `wallets.module.ts` bỏ `forFeature`; `app.module.ts` → `PrismaModule`.
- `entities/tracked-wallet.entity.ts` → interface + `toTrackedWallet()` (strip `id`, Prisma model type).
- `configuration.ts`: bỏ `synchronize` (hết auto-sync); `backend/.env.example` + `DATABASE_URL` optional.
- Deps: +`@prisma/client@7`, `@prisma/adapter-pg@7`, `prisma@7` (dev); −`typeorm`, `@nestjs/typeorm` (giữ `pg` cho adapter).
- `frontend/.env` tạo từ `.env.example` (`NEXT_PUBLIC_API_URL=""`, `BACKEND_URL` local).

## Verify (xanh 2026-09-29)

- BE tsc ✅ (sau 2 lỗi path `../` → `./` / `../../../` đã fix).
- `migrate dev --name init` ✅ (trước đó DROP bảng TypeORM cũ — chỉ chứa seeds).
- Boot → seed 10, `id` không leak ✅; add → 11 ✅; restart → 11 (không seed trùng) ✅; PATCH/DELETE ✅; DB về 10 ✅; portfolio + SSE `CONNECTED` ✅.

## Docs sync

- `backend/README.md` (layout + Database section), `backend/.env.example`, `docs/setup/ENV.md` + `LOCAL_SETUP.md`, `architecture-notes.md`, `context-map.json`, `refactor-log.md`.
- Rule mới giữ nguyên từ pass 2 (`@Inject`, `validateDto`, query thủ công) — PrismaService cũng `@Inject(PrismaService)`.
