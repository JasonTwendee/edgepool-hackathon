# Intent — Docker Compose runtime thay PM2 (API + FE + Worker)

- Date: 2026-10-01
- Stage: intent-bounded → handoff `repo-phase-orchestrator`
- User approvals (2026-10-01, explicit):
  1. Mô hình: **1 process / service** qua `docker compose` thay PM2 trên **Ubuntu cá nhân 24/24**.
  2. Demo hackathon qua **Cloudflare Tunnel (trycloudflare / named tunnel)** trỏ vào FE.
  3. DB + FE runtime: **Postgres container + FE Node (`next start`)** — không static export, không DB managed.
  4. Event/worker: **chưa rõ → cần tư vấn**; đồng ý viết plan **cả 2 phase + kiểm thử kỹ**, Phase 2 để sau hackathon mới run.
  5. Protected: chưa approve edit `backend/src/config/*`, `backend/src/modules/copy-trade/**`, `.env` live — mọi đụng chạm phải hỏi trước.

## 1. Intent contract

- **Intent**: `docker compose up -d --build` là đủ chạy cả stack trên Ubuntu: `postgres + backend (api) + frontend`, kèm `cloudflared` cho demo; thay toàn bộ `pm2 start/restart/logs` hiện tại. Sau hackathon chỉ cần bật thêm profile `worker` để tách background jobs ra process riêng, không sửa API.
- **Business rules**:
  - Phase 1 (hackathon): `SyncService` (poll 20s, `sync.service.ts:23-42`) **ở yên trong API**. Không tách sớm để tránh trùng job + genesis/refactor vội.
  - Phase 2 (post-hackathon): worker dùng **cùng BE image**, khác `command`/`entrypoint`, không expose port; API tắt sync qua env flag.
  - FE giữ `next.config.ts` rewrites `/api/:path* → BACKEND_URL/api/:path*`; trong compose `BACKEND_URL=http://backend:3000` (DNS nội bộ), không dùng `localhost`.
  - BE trong container nghe `0.0.0.0:${PORT}` (hiện `main.ts:17` đã đúng); DB host trong container là `postgres:5432`, ngoài host vẫn `localhost:5433`.
  - Không commit `.env` / secrets; `.env.example` là contract duy nhất được sửa.
  - Error envelope `{success:false,message}` và contract `docs/api/openapi.yaml` giữ nguyên — Docker không được đổi API shape.
- **Non-goals**: k8s/Swarm, managed DB (Neon/RDS), FE static export + nginx, zero-downtime rolling, CI/CD auto-deploy, auth/multi-user, mainnet execution mới, **production deploy setup (domain/TLS/reverse-proxy/named-tunnel — khác hẳn hackathon, làm plan riêng sau)**.
- **Constraints**:
  - Single host Ubuntu cá nhân, RAM/disk hạn chế → image `node:22-alpine` multi-stage, không mang `node_modules` dev lên prod.
  - `trycloudflare` quick tunnel đổi URL mỗi restart → Helius webhook sẽ đứt; demo ok, muốn stable phải named tunnel (ghi runbook, không auto-provision trong plan này).
  - Prisma CLI + runtime phải đồng ý 1 `DATABASE_URL` (xem `backend/prisma.config.ts:9-17` + `prisma.service.ts`); migrate bằng `prisma migrate deploy`, không `db push` trên server.
- **Acceptance (observable)**:
  - `docker compose up -d --build` → `postgres/backend/frontend` đều `healthy/running`; `docker compose ps` xanh.
  - `curl BE trực tiếp /api/health` + `curl qua FE :3001/api/health` (rewrites) đều `ONLINE`.
  - Wallets CRUD 400/404 envelopes, portfolio totals, SSE `CONNECTED` vẫn xanh như smoke cũ.
  - `docker compose logs -f` thay được `pm2 logs`; `restart: unless-stopped` + `depends_on: healthy` thay được `pm2 startup/restart`.
  - Phase 2 (khi bật `worker`): API + worker cùng chạy không double-sync (log `SyncScheduler` chỉ xuất hiện ở 1 bên), tắt worker thì API tự gánh lại (fallback flag).

## 2. Architecture decisions (ADR-style)

- **D1 — Single `docker-compose.yml` mở rộng, không thêm `compose.prod.yml` vội.** File hiện tại chỉ có `postgres`. Thêm `backend/frontend/cloudflared` vào cùng file + `profiles: [tunnel]` cho tunnel. Lý do: single host hackathon, 1 file dễ `up -d`; tách prod file là follow-up khi có VPS thật. Rejected: k8s manifests, Coolify/Dokku.
- **D2 — FE = `next start` Node, không export static.** User đã chốt. Giữ SSR + rewrites, image `node:22-alpine` chạy `next start -p 3001`. Rejected: `output: export` + nginx (mất rewrites, phải viết thêm proxy + CORS).
- **D3 — BE image multi-stage: `deps → builder (prisma generate + tsc -p tsconfig.build.json) → runner (node dist/main.js)` + entrypoint `prisma migrate deploy`.** Lý do: khớp `backend/package.json` (`build`/`start`), runner nhẹ, migrate 1 lần lúc start. Rejected: image dev `tsx src/main.ts` (nặng, không prod-like, mất typecheck build).
- **D4 — Phase 2 worker = cùng image, entrypoint khác + tách module.** `backend/src/worker.ts` mới boot `AppWorkerModule` (chứa `SyncModule`), `AppModule`/`AppApiModule` bỏ `SyncService` khi `ENABLE_SYNC=false`. Hoặc tối thiểu: giữ 1 module + flag `ENABLE_SYNC` để `SyncService.onModuleInit` early-return. Lý do: tránh duplicate poll 20s khi API+worker cùng chạy; flag là bước nhỏ nhất, tách module là bước sạch. Rejected: tách repo/scheduler ngoài (BullMQ/Redis) — quá nặng cho single host hiện tại; để dành nếu copy-trade executor cần queue thật.
- **D5 — Tunnel HACKATHON-ONLY = service `cloudflare/cloudflared` quick tunnel trong compose, không cài binary trên host.** `command: tunnel --no-autoupdate --url http://frontend:3001`, `depends_on: frontend`, `profiles: [tunnel]` (mặc định `up -d` KHÔNG bật tunnel). Lý do: `up --profile tunnel` là có public URL demo ngay, log tập trung. **Production setup khác hẳn** (named tunnel / domain + TLS / reverse proxy / hardening) — out-of-scope, làm plan riêng sau hackathon, không nhét vào P2. Rejected: host `cloudflared` thủ công (lệch khỏi mục tiêu 1 lệnh).
- **D6 — DB giữ `postgres:17-alpine` + volume `fomo-postgres-data` + healthcheck `pg_isready`.** BE `depends_on: postgres healthy`. Không đụng container `api-harness-*` khác. Rejected: managed DB (tốn chi phí + sửa config prod, không cần cho hackathon).
- **D7 — Ports: chỉ expose `3001` (FE) + `5433` (PG debug); BE `3000` để internal, expose optional khi debug.** Tunnel trỏ `http://frontend:3001`. Lý do: giảm bề mặt, FE là single entry, đúng split hiện tại (`:3001 rewrites → :3000`).

## 3. Solution Challenge

- Option A (chọn): Phase 1 containerize API+FE, sync ở yên; Phase 2 worker opt-in. Vì sao thắng: rủi ro thấp nhất cho hackathon, vẫn mở đường post-hackathon; không refactor `SyncModule`/`copy-trade` vội (né protected files).
- Option B (loại): tách worker ngay từ đầu. Thua vì: phải sửa `app.module.ts` + `configuration.ts` (critical) + `copy-trade/**` (sensitive) trước demo, dễ vỡ boot + double-sync, chưa có reproduction/lock.
- Option C (loại): 1 container supervisor chạy cả API+FE+sync (PM2-style trong Docker). Thua vì: anti-pattern, mất healthcheck riêng, log lẫn, scale lẻ không được, đi ngược yêu cầu 1 process/service.
- Counterargument: sync 20s poll RPC nặng có thể block API event-loop → đáp: hiện `syncOnce` đã overlap-guarded + per-wallet try/catch (`sync.service.ts:48-77`); nếu demo thấy lag mới bật worker sớm, flag đã chuẩn bị sẵn ở Phase 1 (`ENABLE_SYNC`).
- Residual risk: `trycloudflare` URL đổi → webhook/demo link gãy giữa buổi; mitigate bằng runbook named tunnel + ghi rõ trong `docs/setup/DOCKER.md`.

## 4. System Design Gate

- **Boundary**: FE public (`:3001`) → BE internal (`backend:3000`) → PG internal (`postgres:5432`). Tunnel chỉ forward FE. Không auth mới, không đổi `openapi.yaml`.
- **Data-flow**: Prisma runtime `getConfig()` build URL từ `POSTGRES_*`; CLI `prisma.config.ts:dbUrl()` cùng logic + `DATABASE_URL` override thắng cả hai. Compose phải set `POSTGRES_HOST=postgres`, `POSTGRES_PORT=5432`, `DATABASE_URL` (optional) đồng nhất cho cả `migrate` + `node`.
- **Failure modes**: PG chưa healthy → BE crash-loop (mitigate `depends_on` + retry entrypoint); migrate fail → container exit non-zero, log rõ (không swallow); FE build thiếu `BACKEND_URL` → rewrites rơi về `localhost:3000` (mitigate: bake `BACKEND_URL` lúc `docker build` hoặc runtime env, test `curl :3001/api/health` bắt buộc); tunnel restart đổi URL (mitigate: docs).
- **Compatibility**: `.env.example` BE/FE thêm keys mới (`POSTGRES_HOST`, `BACKEND_URL`, `ENABLE_SYNC`, `TUNNEL_URL` docs) nhưng values live vẫn ở `.env` untracked; legacy `src/` đã xóa nên không còn compat shim.
- **Operational**: `restart: unless-stopped`, `healthcheck` BE `wget /api/health`, FE `wget /api/health` (qua rewrites → cũng cover BE), PG `pg_isready`; logs via `docker compose logs`; volume PG persist; `prisma migrate deploy` idempotent.

## 5. Bounded specification

**Phase 1 — containerize hackathon (không refactor BE):**
1. `backend/Dockerfile` (mới): `node:22-alpine`, `npm ci`, `prisma generate`, `npm run build`, runner `node dist/main.js` + `docker-entrypoint.sh` chạy `prisma migrate deploy && exec node dist/main.js`. `.dockerignore` loại `node_modules/dist/.env`.
2. `frontend/Dockerfile` (mới): `node:22-alpine`, `npm ci`, `NEXT_PUBLIC_*` bake-time args, `npm run build`, runner `next start -p 3001`. `.dockerignore` loại `.next/node_modules/.env*`.
3. `docker-compose.yml` (mở rộng): services `postgres` (giữ) + `backend` (build `./backend`, env `POSTGRES_HOST=postgres/PORT=5432`, `PORT=3000`, `ENABLE_SYNC=true`, healthcheck, depends postgres) + `frontend` (build `./frontend`, env `BACKEND_URL=http://backend:3000`, `PORT=3001`, depends backend healthy) + `cloudflared` (image `cloudflare/cloudflared:latest`, `profiles: [tunnel]`, depends frontend). Volumes + networks giữ tối giản.
4. `.env.example` (root/BE/FE): bổ sung keys Docker (`POSTGRES_HOST/PORT`, `BACKEND_URL`, `ENABLE_SYNC`, tunnel ghi chú) — values mẫu, không secrets.
5. `docs/setup/DOCKER.md` (mới): `up/build/logs/down/volume`, Ubuntu 24/24 + `cloudflared` quick vs named tunnel, troubleshooting (migrate, rewrites, port bận).
6. Không sửa `backend/src/config/*`, `copy-trade/**`, `app.module.ts` ở Phase 1.

**Phase 2 — worker split (post-hackathon, opt-in):**
1. `backend/src/worker.ts` (mới) + `app.api.module.ts` / `app.worker.module.ts` (tách từ `app.module.ts`): Api không import `SyncModule` khi `ENABLE_SYNC=false`; Worker chỉ import `Prisma/Solana/Sync (+copy-trade executor khi cần)`.
2. Hoặc tối thiểu: `SyncService` đọc `ENABLE_SYNC` và early-return trong `onModuleInit` (1 flag, không tách module) — chọn sau khi đo duplicate-log ở staging.
3. `backend/Dockerfile` giữ nguyên (cùng image); `docker-compose.yml` thêm service `worker` (`build: ./backend`, `command: node dist/worker.js`, `env ENABLE_SYNC=true`, API set `ENABLE_SYNC=false`, `deploy replicas: 1`, không ports, cùng `depends_on postgres healthy`).
4. Lock tối thiểu: `running` guard đã có; nếu scale worker >1 cần DB advisory lock / `pg_try_advisory_lock` — ghi rõ là out-of-scope trừ khi demo trùng log.
5. Nếu worker đụng `copy-trade/**` execution logic → phải xin approval riêng theo `protected-files.md` trước khi code.

## 6. Task breakdown (sang phase plan)

- P1: Dockerfiles + compose core (postgres/backend/frontend) + `.dockerignore` + `.env.example` keys + `DOCKER.md` + verify local `up/build/health/CRUD/SSE`.
- P2: Tunnel service + Ubuntu runbook (quick vs named) + restart/persist/volume test + `project-indexer` (indexes + context-map).
- P3 (post-hackathon, chưa run): worker entrypoint + flag/tách module + compose `worker` profile + anti-double-sync test + approval nếu đụng protected.

## 7. Test contract

- Static: `npm run typecheck` (BE+FE) xanh trước mọi `docker build`.
- Build: `docker compose build backend frontend` xanh, image runner không chứa `tsx/.env` (check `docker history` + `.dockerignore`).
- Runtime Phase 1: `docker compose up -d --build` → `ps` healthy; `curl -s localhost:3000/api/health`, `curl -s localhost:3001/api/health` đều `ONLINE`; wallets CRUD 400/404 envelopes; portfolio totals; SSE `CONNECTED`; `docker compose logs backend/frontend` không crash-loop; `docker restart fomo-backend` tự recover; volume PG persist sau `down` (không `down -v`).
- Runtime Phase 2 (khi bật): `docker compose --profile worker up -d` → log `SyncScheduler` chỉ ở worker, API im; `docker compose stop worker` → API gánh lại (nếu fallback flag) hoặc báo rõ degraded; không duplicate `+N new` cho cùng wallet trong cùng interval.
- Tunnel: `docker compose --profile tunnel up cloudflared` in public URL, mở từ máy khác vào được FE + `/api/health` qua rewrites.
- Regression: `docs/api/openapi.yaml` + FE `lib/api.ts` không đổi shape; `npx tsc` vẫn là gate trước merge.

## 8. Agent cards

- `planner` — chốt phase boundaries P1/P2/P3 + dependencies (DB healthy → migrate → API → FE → tunnel).
- `architect` — lock D1–D7, data-flow DB URL, failure modes.
- `solution_challenger` — đã chạy (mục 3); giữ để review nếu ai đòi tách worker sớm.
- `system_designer` — boundary/network/ports/migration/compat (mục 4).
- `senior_qa` — edge matrix (PG down, migrate fail, BACKEND_URL sai, tunnel đổi URL, double-sync), regression smoke, acceptance verdict.
- `project-indexer` — sau P1/P2 cập nhật `context-map.json`, `project-index.md`, `*-index.md`.
- BE profile skills (`nestjs-*`) chỉ dùng ở P3 nếu refactor worker chạm NestJS runtime; FE không dùng `nestjs-*`.

## 9. Protected-file / risk concerns

- `backend/.env`, `.env*` (trừ `.example`), `*.pem/vault*.json` — KHÔNG đọc/commit values; chỉ sửa `.example`.
- `backend/src/config/*` — Phase 1 KHÔNG sửa; Phase 2 nếu cần thêm `ENABLE_SYNC` vào `configuration.ts` phải hỏi trước.
- `backend/src/modules/copy-trade/**` — Phase 1 KHÔNG đụng; Phase 2 worker nếu đụng execution logic phải approval riêng.
- `frontend/public/vault_system_design_specification.html`, `metadata.json` — không đụng.
- Rủi ro cao nhất: DB URL lệch giữa CLI/runtime (mitigate: 1 `DATABASE_URL` + test migrate), `BACKEND_URL` sai (mitigate: smoke qua FE bắt buộc), tunnel ephemeral (mitigate: runbook), double-sync Phase 2 (mitigate: flag + log assert).

## 10. Next skill

`repo-phase-orchestrator` — viết `docs/codexminimal/plans/2026-10-01-docker-compose-runtime-phase-plan.md` + tracker, rồi native execution từng phase. Stop khi: P1+P2 evidence đủ (P3 để `planned`, chưa run).
