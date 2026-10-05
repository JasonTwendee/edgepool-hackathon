# Phase Plan — Docker Compose runtime thay PM2

## Overview

- Feature: Dockerize FE/BE/postgres + tunnel (Phase 1 hackathon) + worker split opt-in (Phase 2 post-hackathon)
- Spec path: `docs/codexminimal/idsd/2026-10-01-docker-compose-runtime-intent.md`
- Tracker path: `docs/codexminimal/trackers/2026-10-01-docker-compose-runtime-tracker.md`
- Goal: `docker compose up -d --build` chạy cả stack trên Ubuntu 24/24, thay `pm2`; Phase 2 chỉ bật khi cần, không double-sync.
- Architecture notes: single `docker-compose.yml` mở rộng; FE `next start :3001` rewrites → `http://backend:3000`; BE `node dist/main.js` + `prisma migrate deploy`; tunnel service `cloudflared` profile; worker cùng image khác command (Phase 2).
- Protected-file concerns: Phase 1 KHÔNG sửa `backend/src/config/*`, `copy-trade/**`, `.env` live. Phase 2 đụng tới mới hỏi approval (xem intent §9).
- External execution workflow: `repo-phase-orchestrator` → native execution (OpenCode build agent), từng phase + verify mới sang phase tiếp.

## Phase 1 — Containerize API + FE (hackathon-ready, sync ở yên)

### Goal

Chạy `postgres + backend + frontend` bằng 1 lệnh trên Ubuntu, smoke xanh như dev split hiện tại.

### Scope

Trong phạm vi: `backend/Dockerfile`, `frontend/Dockerfile`, 2 `.dockerignore`, `docker-compose.yml`, `.env.example` (root/BE/FE) keys Docker, `docs/setup/DOCKER.md`.
Ngoài phạm vi: mọi sửa `backend/src/**` runtime, worker, named tunnel provision, CI/CD.

### Inputs from spec

Intent §1, §5 (Phase 1), D1–D3/D6–D7, test contract runtime Phase 1.

### Files or modules in scope

- Mới: `backend/Dockerfile`, `backend/.dockerignore`, `backend/docker-entrypoint.sh`, `frontend/Dockerfile`, `frontend/.dockerignore`, `docs/setup/DOCKER.md`
- Sửa: `docker-compose.yml`, `backend/.env.example`, `frontend/.env.example`, root `.env.example` (nếu có, nếu chưa thì ghi chú trong DOCKER.md)
- Đọc (không sửa): `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/prisma.config.ts`, `backend/package.json`, `frontend/package.json`, `frontend/next.config.ts`, `docs/ai/protected-files.md`

### Detailed steps

1. Đọc `protected-files.md` + xác nhận không đụng protected ở Phase 1; ghi vào tracker.
2. Viết `backend/.dockerignore` (`node_modules`, `dist`, `.env`, `*.log`, `.git`).
3. Viết `backend/Dockerfile` multi-stage:
   - `deps`: `node:22-alpine`, `npm ci --only=production=false`
   - `builder`: `COPY prisma ./prisma`, `RUN npx prisma generate`, `COPY src tsconfig*`, `RUN npm run build`
   - `runner`: `node:22-alpine`, `ENV NODE_ENV=production`, `COPY --from=builder dist + node_modules(prod) + prisma + package.json`, `COPY docker-entrypoint.sh`, `EXPOSE 3000`, `HEALTHCHECK wget /api/health`, `ENTRYPOINT migrate deploy + node dist/main.js`.
4. Viết `backend/docker-entrypoint.sh`: `set -e`, `npx prisma migrate deploy`, `exec node dist/main.js`; `chmod +x`.
5. Viết `frontend/.dockerignore` (`.next`, `node_modules`, `.env*`, `*.log`).
6. Viết `frontend/Dockerfile`: `deps → builder (ARG BACKEND_URL, ENV BACKEND_URL, npm run build) → runner (COPY .next/standalone nếu bật, hoặc full .next + node_modules prod, CMD next start -p 3001)`. Phase này giữ full `.next` (chưa ép `standalone`) để giảm rủi ro; ghi TODO standalone ở Phase 2 polish.
7. Mở rộng `docker-compose.yml`:
   - `postgres`: giữ nguyên (healthcheck đã có).
   - `backend`: `build: ./backend`, `container_name: fomo-backend`, `restart: unless-stopped`, `env_file: ./backend/.env` + `environment: POSTGRES_HOST=postgres, POSTGRES_PORT=5432, PORT=3000, ENABLE_SYNC=true`, `expose: [3000]`, `ports: []` (debug thì mở `3000:3000` tạm), `depends_on: postgres healthy`.
   - `frontend`: `build: ./frontend`, `container_name: fomo-frontend`, `restart: unless-stopped`, `environment: BACKEND_URL=http://backend:3000, PORT=3001`, `ports: [3001:3001]`, `depends_on: backend healthy` (cần thêm healthcheck BE `curl /api/health`).
8. Cập nhật `.env.example` (BE: `POSTGRES_HOST/PORT`, `ENABLE_SYNC=true` + comment Docker; FE: `BACKEND_URL` + comment compose DNS; root: `POSTGRES_*` nếu dùng).
9. Viết `docs/setup/DOCKER.md`: yêu cầu Docker 24+, `up -d --build`, `ps/logs/down`, `down -v` cảnh báo mất data, fix port bận 5433/3001, `prisma migrate` flow, `BACKEND_URL` pitfall.
10. Local verify theo Verification bên dưới; fix loop tối đa trong scope Dockerfile/compose/env-example.

### Verification commands

- `npm run typecheck` (root = BE+FE) → PASS
- `docker compose build backend frontend` → PASS, không lọt `.env` (check `docker image inspect` / `.dockerignore`)
- `docker compose up -d --build` → `docker compose ps` → 3 services running/healthy
- `curl -s http://localhost:3000/api/health` → `ONLINE` (nếu expose BE; nếu không, `docker compose exec backend wget -qO- localhost:3000/api/health`)
- `curl -s http://localhost:3001/api/health` → `ONLINE` (bắt buộc — chứng minh rewrites FE→BE)
- Wallets list/create 400/404 envelope + portfolio totals + SSE `CONNECTED` (reuse smoke cũ, trỏ `:3001` trước, `:3000` sau)
- `docker compose logs backend --tail=100` không crash-loop; `docker restart fomo-backend` → tự healthy lại
- `docker compose down` rồi `up -d` → data PG còn (wallets đã tạo vẫn còn)

### Acceptance criteria

- 1 lệnh `up -d --build` dựng được stack từ máy sạch (sau `down -v` + rebuild) trong <10 phút trên Ubuntu cá nhân.
- Smoke BE trực tiếp + qua FE đều xanh; envelopes giữ nguyên.
- `restart: unless-stopped` + `depends_on healthy` chứng minh được bằng restart test.
- Không file protected nào bị sửa (check `git status` chỉ có Dockerfile/compose/docs/example).

### Expected outputs

Dockerfiles + compose chạy được, `DOCKER.md`, `.env.example` keys mới, log smoke dán vào tracker.

### Stop condition

Dừng khi verification trên PASS hết hoặc ghi blocker (port bận, build OOM, migrate fail) với log. Không tự ý sửa `src/**` để cho xanh.

### Handoff notes

Sang Phase 2 khi Phase 1 tracker `done` + smoke log đủ. Phase 2 không được sửa kết quả Phase 1 trừ khi tunnel cần thêm env.

## Phase 2 — Tunnel demo HACKATHON-ONLY (chưa run)

> Scope khóa: quick `trycloudflare` tunnel cho demo. **Production setup khác hẳn** (domain/TLS/reverse-proxy/named tunnel/hardening) — không thuộc phase này, làm plan riêng sau hackathon.

### Goal

Thêm service `cloudflared` (opt-in qua `--profile tunnel`) + runbook demo, chứng minh máy khác vào được qua public URL ephemeral.

### Scope

Trong: `docker-compose.yml` thêm `cloudflared`, `docs/setup/DOCKER.md` bổ sung tunnel + hardening (restart, disk, backup volume), `project-indexer` cập nhật indexes.
Ngoài: worker (để Phase 3), named tunnel auto-provision, TLS riêng (Cloudflare lo).

### Inputs from spec

Intent D5, failure modes tunnel, test contract tunnel + persist.

### Files or modules in scope

- Sửa: `docker-compose.yml` (thêm service), `docs/setup/DOCKER.md`
- Đọc: `frontend/next.config.ts` (xác nhận rewrites chịu `X-Forwarded-*`), `docs/ai/*-index.md` để indexer cập nhật

### Detailed steps

1. Thêm service `cloudflared`: `image: cloudflare/cloudflared:latest`, `container_name: fomo-tunnel`, `restart: unless-stopped`, `command: tunnel --no-autoupdate --url http://frontend:3001`, `depends_on: frontend healthy`, `profiles: [tunnel]`, không ports.
2. Test local: `docker compose --profile tunnel up -d cloudflared` → `docker compose logs cloudflared` lấy `https://*.trycloudflare.com` → mở từ máy khác/phone: `/` + `/api/health` đều 200.
3. Runbook Ubuntu: `docker compose up -d --build` (không tunnel khi dev) vs `docker compose --profile tunnel up -d` (khi demo); `sudo systemctl enable docker`; logrotate/`docker system prune` note; backup volume `docker run --rm -v fomo-postgres-data:/data -v $(pwd):/backup alpine tar czf /backup/pg-$(date +%F).tar.gz /data`.
4. Negative test: `docker compose stop frontend` → tunnel 502 (ghi expected); `start` lại → tự hồi không cần restart tunnel.
5. Chạy `project-indexer`: cập nhật `docs/ai/project-index.md`, `context-map.json` (services, entrypoints, smoke via compose), `docs/ai/*-index.md` liên quan + `artifact-registry.json`.
6. Ghi rõ limitation `trycloudflare` ephemeral + hướng dẫn named tunnel 5 bước (login/create/route/dns) để sau dùng, không implement trong phase này.

### Verification commands

- `docker compose --profile tunnel up -d` → `docker compose ps` 4 services (khi bật profile)
- `docker compose logs cloudflared --tail=30` có public URL
- `curl -s <tunnel-url>/api/health` từ máy demo (hoặc `curl -H "Host: ..."` nếu cần) → `ONLINE`
- `docker compose stop frontend` → tunnel 502; `docker compose start frontend` → 200 lại
- `docker volume ls | grep fomo-postgres-data` tồn tại sau `down` (không `-v`)

### Acceptance criteria

- Demo từ mạng khác vào được FE + API qua 1 public URL, không sửa code.
- Runbook đủ để reboot Ubuntu xong `up -d` là live lại.
- Indexes/context-map cập nhật, không drift với compose thực tế.

### Expected outputs

Compose có tunnel, `DOCKER.md` hoàn chỉnh, log demo URL (che bớt nếu public), index updates.

### Stop condition

Dừng khi demo e2e PASS hoặc blocker mạng (ISP chặn, Cloudflare quota) được ghi + fallback (host binary tunnel) nêu rõ.

### Handoff notes

Phase 3 (worker) ở trạng thái `planned`, không run. Mọi approval protected cho Phase 3 để riêng, không lẫn vào Phase 1–2.

## Phase 3 — Worker split (PLANNED, post-hackathon, chưa run)

### Goal

Tách background sync (và sau này copy-trade executor) ra service `worker` opt-in, API + worker không double-sync.

### Scope

Chưa thực thi. Phạm vi dự kiến: `backend/src/worker.ts`, `app.api/worker.module.ts` hoặc flag `ENABLE_SYNC`, `docker-compose.yml` service `worker`, `backend/.env.example` (`ENABLE_SYNC`), `configuration.ts` (nếu cần — CẦN APPROVAL).

### Inputs from spec

Intent §5 (Phase 2), D4, QA double-sync.

### Files or modules in scope (dự kiến)

- Mới: `backend/src/worker.ts`
- Tách: `backend/src/app.module.ts` → `app.api.module.ts` + `app.worker.module.ts` (hoặc giữ + flag)
- Sửa: `backend/src/modules/sync/sync.service.ts` (early-return khi `ENABLE_SYNC=false`), `docker-compose.yml`, `backend/Dockerfile` (nếu cần 2nd CMD)
- Nhạy cảm: `backend/src/modules/copy-trade/**` nếu executor vào worker — APPROVAL RIÊNG.

### Detailed steps (dự kiến, chưa run)

1. Xin approval protected nếu đụng `config/*` / `copy-trade/**`; ghi vào tracker trước khi code.
2. Thêm `ENABLE_SYNC` (default `true` để tương thích Phase 1) vào `SyncService.onModuleInit` early-return + test.
3. Tạo `worker.ts` boot `AppWorkerModule` (Prisma+Solana+Sync); `AppApiModule` không import `SyncModule` khi flag off.
4. Thêm service `worker`: `build: ./backend`, `command: node dist/worker.js`, `environment: ENABLE_SYNC=true`, API override `ENABLE_SYNC=false`, `depends_on: postgres healthy`, không ports, `profiles: [worker]` hoặc default 1 replica (quyết lúc run).
5. Anti-double-sync test: bật cả API+worker, grep log `SyncScheduler` 2 interval liên tiếp, assert chỉ 1 bên; stop worker → API fallback (nếu thiết kế vậy).
6. `nestjs-code-reviewer` trước merge + `project-indexer` sau.

### Verification commands (dự kiến)

- `npm run typecheck` + `docker compose --profile worker build worker`
- `docker compose --profile worker up -d` → `docker compose logs api/worker | grep SyncScheduler` chỉ 1 nguồn
- Wallets/portfolio/SSE smoke vẫn xanh khi worker chạy
- `docker compose stop worker` → hệ thống degraded rõ ràng (log hoặc health field), không mất API

### Acceptance criteria (dự kiến)

- Bật/tắt worker không đổi API contract; không duplicate sync; fallback rõ ràng.
- Protected approvals đầy đủ trong tracker.

### Stop condition

Phase này `planned` — KHÔNG run cho tới khi user yêu cầu sau hackathon. Mọi lệnh trên chỉ là spec, chưa evidence.

### Handoff notes

Khi user gọi run Phase 3, mở tracker mới từ trạng thái này, xin approval protected trước, rồi native execution.
