# Tracker — Fund roles/auth (multi-vault nền)

- Topic: fund-roles-auth
- Intent: `docs/codexminimal/idsd/2026-10-02-fund-roles-auth-intent.md` (Rev 2)
- Plan: `docs/codexminimal/plans/2026-10-02-fund-roles-auth-phase-plan.md`
- Started: 2026-10-02
- Statuses: `open` → `in_progress` → `done` | `blocked`
- Quy ước: routes cũ giữ public; không đụng `copy-trade/**`; không dep mới.

## Phases

- [x] P0 contract + schema + migration: `done`
  (openapi 18→28 paths + responses/securitySchemes + 7 schemas; Prisma 6 tables mới +
  Vault.environment + Deposit/Withdrawal.userId; migration `20261002083329_fund_roles_auth`
  deploy xanh; YAML valid; fix luôn lỗi thụt lề có sẵn ở `CopyTradeResponse`)
- [x] P1 users + auth + guards: `done`
  (`solana-verify.ts` node:crypto zero-dep + AuthGuard/RolesGuard + bootstrap
  ADMIN_WALLETS local-only + `assert-auth.ts` GREEN (codec/sign/replay/bootstrap/
  401-403-matrix) + `tsc` ✅)
- [x] P2 audit interceptor + append-only: `done`
  (`assert-audit.ts` GREEN + ADMIN read API + `@Audit('user.set_role')` đã gắn;
  audit fail không phá op chính; `tsc` ✅)
- [x] P3 multi-vault + traders + bots + environment: `done`
  (`VaultService` listVaults/createVault(SANDBOX-only)/assignTrader cap 5/
  removeTrader soft + deposit/withdraw `userId?` qua `OptionalAuthGuard`;
  `bots/` record-only CRUD + mode; `assert-multivault.ts` GREEN; `tsc` ✅;
  asserts cũ vault/paper/rugcheck/datastream vẫn GREEN)
- [x] P4 smoke full + docs/index + review gate: `done`
  (BE rebuild + migrate deploy tự động; live smoke 17/17 PASS incl. ký thật
  nonce→verify→me + deny-matrix 403 + deposit gắn identity; smoke cũ xanh
  (health/wallets/portfolio/SSE/FE); 7/7 asserts GREEN; `tsc` BE+FE ✅;
  ARCHITECTURE §7 + context-map + refactor-log cập nhật;
  reviewer verdict APPROVE — xemrictions bên dưới)

## Review gate (nestjs-code-reviewer) — APPROVE

- Controllers thin, logic trong services, DTO validate显式, query parse thủ công,
  envelope `{success:false}` giữ nguyên, không đụng `copy-trade/**`/`config/*`/`.env`.
- Không leak secret (token lưu sha256, ADMIN_WALLETS không log).
- Suggestions non-blocking (sang P5 hardening): purge `auth_nonces`/`sessions` hết hạn;
  audit cả failed admin attempts (hiện chỉ success); TOCTOU bootstrap/double-verify
  (sandbox-acceptable); POST 201 vs openapi ghi 200 (behavior có sẵn, giữ nhất quán).
- Follow-up còn lại: ADMIN live-E2E (tạo vault/assign/gán role/audit list) cần user
  thêm ví vào `ADMIN_WALLETS` trong `backend/.env` + restart backend; refresh
  `route-index/entity-index/module-index` chi tiết (context-map đã cập nhật).

## Handoff log

- 2026-10-02: intent Rev 2 duyệt; plan viết xong; bắt đầu P0.
- 2026-10-02: P0–P4 đóng. 1 sự cố boot (thiếu `AuditModule` import ở VaultsModule,
  đã fix + ghi rule vào refactor-log). 1 phát hiện contract (openapi
  `CopyTradeResponse` thụt lề sai có sẵn, đã sửa + YAML valid).
- 2026-10-02: ví ADMIN generate (`CuKP…9N5pM`, secret bàn giao user riêng) +
  `ADMIN_WALLETS` vào `backend/.env` (user duyệt) + `.env.example` document.
  ADMIN live-E2E **16/16 PASS**: bootstrap ADMIN, users list, set-role KOL +
  400-cases, vault create (sandbox), assign 5 + cap-400 ở lệnh 6 + remove/retry,
  bot create/pause + 400-case, audit list đủ 3 actions. Fix kèm: `environment`
  lowercase nhất quán ở `createVault` (+ assert update).
- Ops lessons: `docker compose restart` KHÔNG đọc lại `env_file` — đổi `.env`
  phải `up -d <service>` recreate; POST thành công trả 201 là behavior có sẵn
  (giữ nhất quán, smoke chấp nhận 200/201).

## Handoff log

- 2026-10-02: intent Rev 2 duyệt; plan viết xong; bắt đầu P0.
