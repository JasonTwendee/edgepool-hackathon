# Phase plan — Fund roles/auth (multi-vault nền, giữ core logic)

- Intent: `docs/codexminimal/idsd/2026-10-02-fund-roles-auth-intent.md` (Rev 2)
- Tracker: `docs/codexminimal/trackers/2026-10-02-fund-roles-auth-tracker.md`
- Nguyên tắc: additive-only (không đổi shape/contract cũ), không đụng
  `copy-trade/**` execution, không thêm npm dep, không thêm secret mới.
- Scope deviation đã chốt ở plan (ghi rõ để execution khỏi đoán):
  - Routes hiện tại (`/api/vaults/deposit|withdraw|settle|status`, wallets,
    portfolio, SSE…) **giữ public** slice này (tương thích demo/FE cũ).
    RBAC chỉ áp trên routes **mới**: tạo vault, trader assign/remove, bots write,
    gán role, đọc audit. Siết settle/deposit cũ → quyết định ở P5.
  - `CopyOrder` không thêm cột slice này (tránh đụng module protected);
    cờ `environment` chỉ nằm trên `Vault` + envelopes của routes mới.
  - Auth không dùng JWT/nacl dep: opaque bearer token (sha256 trong DB) +
    ed25519 verify bằng `node:crypto` + base58 decode inline.
  - `ADMIN_WALLETS` đọc trực tiếp `process.env` trong `auth/` (không sửa
    `config/configuration.ts` protected).

## Phase map

| Phase | Nội dung | Files chính | Verify |
|---|---|---|---|
| P0 | Contract + schema + migration | `docs/api/openapi.yaml`, `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` | migrate deploy xanh, client regen, `tsc` |
| P1 | `users/` + `auth/` + guards + bootstrap + deny-matrix asserts | `backend/src/modules/{auth,users}/`, `backend/src/common/auth/*`, `assert-auth.ts` | asserts GREEN, 401/403 smoke |
| P2 | `audit/` interceptor + service + ADMIN read API + append-only assert | `backend/src/modules/audit/`, `assert-audit.ts` | asserts GREEN, audit smoke |
| P3 | Multi-vault CRUD + `VaultTrader` (cap 5) + deposit gắn `userId` + `bots/` record + `environment` | `vaults/*` (mở rộng), `bots/`, `assert-multivault.ts` | asserts GREEN, list 2 vaults |
| P4 | Smoke full + `tsc` + docs/index + review gate | indexes, `ARCHITECTURE.md` | full smoke, reviewer pass |

## P0 — Contract + schema + migration (làm ngay)

Mục tiêu: DB và contract sẵn trước khi code modules.

1. `backend/prisma/schema.prisma` += (giữ style hiện tại: `@@map`, Decimal(24,12)):
   - `User`: id, wallet unique VarChar(100), role VarChar(10) default `'USER'`
     (`USER|KOL|ADMIN`), createdAt. `@@map("users")`.
   - `AuthNonce`: id, wallet, nonce unique, expiresAt, consumedAt?, createdAt.
     `@@map("auth_nonces")`, `@@index([wallet])`.
   - `Session`: id, tokenHash unique, userId FK→User CASCADE, expiresAt, createdAt.
     `@@map("sessions")`, `@@index([userId])`.
   - `AuditLog`: id, actor, action VarChar(64), target?, reason?, metaJson Json?,
     createdAt. **Không** quan hệ update/delete trong service (P2). `@@map("audit_logs")`,
     `@@index([actor])`, `@@index([createdAt])`.
   - `VaultTrader`: id, vaultId FK CASCADE, wallet, weightBps Int default 0,
     isActive Boolean default true, createdAt. `@@unique([vaultId, wallet])`,
     `@@map("vault_traders")`.
   - `Bot`: id, name unique, mode VarChar(10) default `'AUTO'` (`AUTO|PAUSED`),
     vaultId? FK SET_NULL, status VarChar(16) default `'IDLE'`, createdAt, updatedAt.
     `@@map("bots")`.
   - `Vault += environment` VarChar(10) default `'SANDBOX'` (`SANDBOX|PRODUCTION`).
   - `Deposit/Withdrawal += userId?` FK→User SET_NULL nullable (tương thích E2E cũ).
2. Migration: `npx prisma migrate dev --name fund-roles-auth` với DATABASE_URL trỏ
   PG local `:5433` (xem `backend/.env.example` + compose service `postgres`).
   Kiểm tra `backend/prisma/migrations/` có folder mới.
3. `docs/api/openapi.yaml` += (additive-only): paths `/api/auth/nonce`,
   `/api/auth/verify`, `/api/auth/me`, `/api/users` (ADMIN), `/api/users/{wallet}/role`
   (ADMIN), `/api/audit` (ADMIN), `/api/vaults` (GET list + POST create ADMIN),
   `/api/vaults/{id}/traders` (GET + POST/DELETE ADMIN), `/api/bots` (GET + POST ADMIN),
   `/api/bots/{id}/mode` (ADMIN); schemas `User/Auth/AuditLog/VaultTrader/Bot` +
   envelope `environment` note. Không sửa paths cũ.
4. Verify P0: `npx prisma migrate deploy` xanh (idempotent) + `npm run typecheck`
   PASS (schema client mới chưa dùng vẫn compile) + `git-less` kiểm tra diff chỉ
   gồm 2 files trên + migration mới.
5. Stop: migrate đỏ → dừng, không sang P1. Không commit (no git repo — như các
   phase trước, chỉ cập nhật tracker).

## P1 — users + auth + guards (TDD assert-first)

1. `backend/src/common/auth/solana-verify.ts`: base58-decode inline + ed25519 verify
   qua `node:crypto` (`createPublicKey` SPKI-DER prefix + `verify(null, msg, key, sig)`).
   Pure function, không DI — test được trực tiếp.
2. `backend/src/common/auth/guards.ts`: `AuthGuard` (Bearer → session → `req.user`,
   thiếu/sai → 401 `{success:false}`), `Roles(...roles)` decorator + `RolesGuard`
   (so `req.user.role`, thiếu → 403 `{success:false}`). `@Inject()`显式 (tsx-safe).
3. `backend/src/modules/users/`: `users.service.ts` (findOrCreate USER, setRole ADMIN-only
   guard ở controller, list), `users.controller.ts` (`GET /api/users`,
   `POST /api/users/:wallet/role` ADMIN-only qua guards), `users.module.ts`, DTOs.
4. `backend/src/modules/auth/`: `auth.service.ts` (issue nonce TTL 5', verify signature
   → findOrCreate user → tạo session token 7d lưu sha256; bootstrap: DB chưa có ADMIN
   nào + wallet ∈ `ADMIN_WALLETS` → gán ADMIN), `auth.controller.ts`
   (`POST nonce/verify/me`), `auth.module.ts`, DTOs. Đọc `process.env.ADMIN_WALLETS`
   trực tiếp (không đụng config protected).
5. `app.module.ts` += `AuthModule, UsersModule` (import 2 dòng — file này không protected).
6. `assert-auth.ts` (mocked Prisma + crypto thật): nonce→verify→me OK; sai signature
   → throw 401; USER qua RolesGuard(ADMIN) → 403; bootstrap ADMIN lần 1 OK, lần 2
   từ chối; session hết hạn → 401. Chạy `npx tsx .../assert-auth.ts` → ALL GREEN.
7. Verify P1: asserts GREEN + `tsc` + smoke live (container rebuild, xem P4) 401/403
   envelopes đúng shape.

## P2 — audit (interceptor + append-only)

1. `backend/src/modules/audit/audit.service.ts`: `record(actor, action, target?, reason?,
   metaJson?)` (create-only — không viết update/delete method), `list(filters)` ADMIN.
2. `AuditInterceptor` (`common` hoặc trong module): đọc `req.user` + route metadata
   (`@Audit(action, targetFrom)`) → `record` sau khi handler thành công (không chặn
   response khi audit fail — log console, tránh làm hỏng op chính; ghi rõ tradeoff).
3. `audit.controller.ts`: `GET /api/audit` (AuthGuard + RolesGuard ADMIN).
   Không có POST/PUT/DELETE route nào cho audit.
4. Gắn `@Audit(...)` vào: gán role (users), tạo vault/trader/bot ops (P3), settle?
   KHÔNG (settle giữ public slice này — ghi rõ).
5. `assert-audit.ts` (mocked): record→list thấy đủ fields; service không expose
   update/delete (assert `typeof svc.update === 'undefined'`); interceptor không auth
   → skip (không crash).
6. Verify P2: asserts GREEN + `tsc`.

## P3 — multi-vault + traders + bots + environment

1. `VaultService` mở rộng (không đổi math): `listVaults()` (kèm trader-set + environment),
   `createVault(name, environment='SANDBOX', actorCtx)` (ADMIN ở controller; từ chối
   `PRODUCTION` nếu chưa có custody — hiện tại từ chối mọi PRODUCTION create với
   message rõ), `setTraders(vaultId, [{wallet, weightBps}])` (validate cap 5 active,
   ví Solana hợp lệ), `removeTrader`. Deposit: nếu `req.user` có → gắn `userId`
   (controller truyền, service nhận optional param — không phá callers cũ).
2. `VaultsController` += `GET /api/vaults`, `POST /api/vaults` (ADMIN+Audit),
   `GET/POST/DELETE /api/vaults/:id/traders` (POST/DELETE ADMIN+Audit). Responses
   kèm `environment`. Các routes cũ giữ nguyên behavior.
3. `bots/` mới: `Bot` CRUD tối thiểu + `POST /api/bots/:id/mode` (`AUTO|PAUSED`, ADMIN+Audit).
   Không execution logic.
4. `assert-multivault.ts` (mocked): tạo 2 vaults, set traders (cap 5 → cái thứ 6
   reject), deposit gắn userId, list đúng trader-set riêng, create PRODUCTION → reject.
5. Verify P3: asserts GREEN + `tsc`.

## P4 — Tích hợp + review gate

1. Rebuild containers: `docker compose build + up -d` (theo quy ước BE/FE đổi code),
   chạy migration qua entrypoint (tự `migrate deploy`).
2. Smoke full: cũ (health/wallets/portfolio/SSE/400-404/history/vault-status/market/FE 200)
   + mới (auth nonce/verify/me, RBAC 401/403, audit list ADMIN vs 403 USER, vaults list,
   2 vaults + traders, bots mode, `environment:"sandbox"` hiện diện).
3. `npm run typecheck` PASS; 4 asserts cũ + 3 asserts mới ALL GREEN.
4. Docs: `ARCHITECTURE.md` (+RBAC/audit/env section ngắn), `docs/ai/*` refresh
   (context-map stale đã biết + controllers mới) — qua `project-indexer` hoặc tay gọn.
5. Gate `nestjs-code-reviewer`: signature handling, guard coverage, mass-assignment role,
   audit bypass, `ADMIN_WALLETS` parse. Pass → đóng tracker, telemetry event, cập nhật
   current-work `done`.
6. Stop conditions toàn plan: đỏ `tsc`/migrate/smoke → dừng fix cùng phase; chạm
   `copy-trade/**`/`config/*`/`.env` values → dừng + hỏi (blocking rule).

## Verification commands (dùng lại mọi phase)

```bash
npm run typecheck
npx --prefix backend tsx src/modules/auth/assert-auth.ts
npx --prefix backend tsx src/modules/audit/assert-audit.ts
npx --prefix backend tsx src/modules/vaults/assert-multivault.ts
docker compose build && docker compose up -d
curl -s http://localhost:3000/api/health
curl -s http://localhost:3001/api/health
```
