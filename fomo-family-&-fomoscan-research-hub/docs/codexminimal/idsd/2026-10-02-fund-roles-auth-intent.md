# Intent — Fund roles/auth trước, hướng multi-vault (giữ core logic)

- Date: 2026-10-02 (Rev 2 — hiệu chỉnh theo full fund spec §§1–20)
- Stage: intent-bounded → chờ duyệt scope protected → handoff `repo-phase-orchestrator`
- Source: System Context & Product Requirements (fund spec §§1–20, user paste 2026-10-02)
- User decisions (2026-10-02, explicit, via router questions):
  1. Scope slice đầu tiên: **Roles/auth** (USER/ADMIN/KOL + permissions + audit log).
  2. Vault topology mục tiêu: **multi-vault** (mỗi vault track 3–5 trader).
  3. Allocation: **giữ NAV-sizing hiện tại** (`min(1% NAV, 0.1 SOL, cap)` + exposure caps) — không đổi core logic.
  4. Demo: **real-time + sim execution** (signal live 10 ví thật, execution simulated — đúng pipeline hiện tại).
- Khung roadmap theo §17 (3 layer không trộn lẫn): **(T1) trading automation** →
  **(T2) treasury automation** → **(T3) admin override** (control mechanism, exception).
  Slice này đặt nền T3-nền (identity + RBAC + audit) + chuẩn bị data model cho T1/T2.

## 1. Intent contract

- **Intent**: dựng authorization layer cho quỹ: mọi actor có identity (wallet-based) +
  role (`USER | ADMIN | KOL`) → mọi admin/vault operation ghi actor + timestamp +
  audit log append-only → user/KOL có accounting riêng theo NAV shares → chuẩn bị
  multi-vault (vault có trader-set riêng 3–5 ví) mà **không đổi core trading logic**.
- **Business rules**:
  - Identity = Solana wallet address + message-signature login (không password;
    `depositor` hiện đã là wallet string — tương thích).
  - Admin bootstrap: ví ADMIN đầu tiên qua allowlist `ADMIN_WALLETS` trong
    `backend/.env` (local-only, không commit); khi DB chưa có ADMIN nào, ví trong
    allowlist verify signature → được gán ADMIN. Về sau chỉ ADMIN gán role.
  - Roles (§§3–4, §10):
    - `USER`: xem trader/performance/PnL public + deposit/withdraw theo policy.
      Danh sách cấm显式 (§3.1 — đưa vào deny-matrix test): tạo bot, tạo vault,
      đổi core logic, điều khiển copy-trade engine, đổi allocation, can thiệp
      trader tracking, điều khiển treasury.
    - `KOL`: như USER + portfolio/PnL riêng; không có quyền admin mặc định.
    - `ADMIN`: quản trị operational layer (bot/vault/trading status) + override
      AUTO mode. Override là **exception/emergency** (§8), không phải workflow thường.
  - Bot default mode = **AUTO** (§8: auto trade/copy/cash-management ON theo policy);
    ADMIN có thể pause/resume — pause/resume là admin op phải audit.
  - Mọi state-changing admin op (pause/resume, force cash-out/withdraw, settle,
    vault config, gán role) **bắt buộc** actor + reason + audit row; thiếu → 400/403.
  - Bất biến accounting cho mọi admin cash-out (§9): logged + audited + gắn
    transaction + timestamp + actor + cập nhật vault/treasury balance + không
    làm sai lệch PnL. Chưa có treasury module → mọi cash-out hiện tại chỉ là
    paper `Withdrawal` trên vault sandbox (ghi rõ giới hạn này trong API docs).
  - Audit log: append-only — không có API update/delete; DB-level revoke update/delete
    cho role service (migrate + comment). (Trả lời F30: có, immutable.)
  - KOL accounting = cùng công thức NAV shares như USER, chỉ khác view/portfolio
    riêng (E24 chốt ở mức này cho tới khi có yêu cầu khác).
  - Multi-vault ⇒ user ĐƯỢC giữ shares ở nhiều vault (trả lời A1: nhiều vault).
    Cap trader/vault = 5 mặc định (§5 "3–5"), enforce ở `VaultTrader` assign (A2:
    hard cap 5, nới cần decision mới).
  - Env isolation (§15, BE-enforced — không chỉ FE): mọi execution/accounting row
    mang cờ `environment` (`SANDBOX` default; `PRODUCTION` chưa active). Execution
    layer từ chối chạy production khi cờ hiện tại là sandbox và ngược lại. Mọi
    response của simulated execution gắn `environment:"sandbox"`显式 (§13).
  - Giữ nguyên Solution v2 paper pipeline (1-click, devnet, drag-guard, caps,
    qualify gates) — slice này không đụng execution.
- **Non-goals** (slice này KHÔNG làm — xếp roadmap 3 tracks §17):
  - (T1) Auto-fire / bot execution engine (§7 target mode) — phase sau, cần duyệt
    `copy-trade/**` riêng. Slice này chỉ tạo `Bot` record + status (T3-operational).
  - (T2) Treasury automation / cash-out policy / reserve ratio / withdrawal
    window-fee-lock (§9, D17–D20) — phase sau; hiện tại withdrawal = paper trên sandbox.
  - Đổi core logic (signal, sizing, TP/stop, risk) — source of truth giữ nguyên (§18).
  - Real funds / production custody / mainnet execution — cấm tuyệt đối; cờ
    `PRODUCTION` tồn tại nhưng mọi execution path production chưa implement → từ chối.
  - FE login wall đầy đủ + DEMO labels — BE contract + guards trước, FE theo sau
    (ghi rõ để không ai tưởng auth đã xong ở UI).
- **Constraints**:
  - Không sửa `backend/src/modules/copy-trade/**` execution logic (protected, chưa duyệt).
  - Không thêm secrets mới vào `.env` ngoài ví dụ (nonce store nằm trong DB).
  - Additive-only với `openapi.yaml` (thêm paths, không đổi shape cũ) + envelope
    `{success:false,message}` giữ nguyên.
  - tsx-safe (rule hiện hành): `@Inject()`显式, `validateDto()`显式, query parse thủ công.
- **Acceptance (observable)**:
  - `POST /api/auth/nonce` + `POST /api/auth/verify` (wallet signature) → session/token;
    không signature hợp lệ → 401 envelope. Ví trong `ADMIN_WALLETS` bootstrap được
    ADMIN khi DB chưa có admin (sau đó allowlist vô hiệu cho gán role).
  - Matrix phân quyền xanh theo deny-list §3.1: USER gọi tạo bot/vault, đổi allocation,
    treasury op → 403; ADMIN pause bot → audit row có actor+reason; audit `GET` không
    có DELETE/PUT route tồn tại.
  - `GET /api/vaults` liệt kê được >1 vault, mỗi vault có trader-set 3–5 ví;
    deposit ghi đúng `userId` + shares theo NAV hiện tại; user giữ shares nhiều vault.
  - Mọi response simulated execution/accounting có `environment:"sandbox"`; gọi
    execution với `environment:production` → từ chối显式 (chưa implement).
  - `tsc` BE+FE ✅, smoke cũ (health/wallets/portfolio/SSE/envelopes) vẫn xanh,
    asserts paper/vault/rugcheck/datastream vẫn ALL GREEN.

## 2. Architecture decisions (ADR-style)

- **D1 — Wallet-signature auth (thay vì password/OAuth)**. Lý do: toàn bộ domain đã
  định danh bằng wallet (depositor, master wallets, vault pubkey); không tạo thêm
  secret surface; phù hợp Solana fund. Nonce lưu DB, TTL ngắn, verify on BE.
  Admin bootstrap qua `ADMIN_WALLETS` allowlist (chỉ có hiệu lực khi DB chưa có ADMIN).
- **D2 — RBAC bằng NestJS Guards (`AuthGuard` + `RolesGuard`) trên route, không
  rẽ nhánh trong service logic**. Lý do: tách authorization khỏi business logic;
  service giữ nguyên signature để phase auto-fire tái dùng.
- **D3 — Audit = module riêng `audit/` + interceptor, bảng `audit_logs` append-only**.
  Lý do: §9 yêu cầu mọi admin withdrawal/cash-out logged/audited; interceptor tránh
  quên ghi ở từng controller.
- **D4 — Multi-vault qua `vault_traders` join (vault_id, wallet, weight_bps, active)**.
  Lý do: Vault hiện tại không có trader-set; join table cho phép rebalance/kick trader
  mà không đụng `CopyOrder`/`Transaction` history (A4–A5 để phase sau). Cap 5/vault
  enforce ở assign.
- **D5 — User/KOL accounting = shares trên vault (mở rộng Deposit/Withdrawal có
  `userId` FK nullable, giữ `depositor` string để tương thích)**. Lý do: backward
  compat với E2E alice/bob hiện tại; nullable FK = migrate không phá data.
- **D6 — Contract-first**: `openapi.yaml` thêm ` /api/auth/*`, `GET /api/vaults`,
  `vaultTraders` schema trước; BE DTO + FE types mirror theo.
- **D7 — Env isolation bằng data (`environment` enum), không bằng FE flag**. Lý do:
  §15 yêu cầu enforce ở BE; `SANDBOX` default; mọi execution path check env trước khi
  chạy — production path chưa implement nên luôn từ chối显式, không thể vô tình
  chạm real fund (đón đầu H-câu hỏi về transition/migration).
- **D8 — `Bot` là record operational tối thiểu (name, mode AUTO/PAUSED, vaultId?,
  status), KHÔNG chứa execution logic**. Lý do: §4.1 yêu cầu admin tạo/cấu hình/
  enable-disable/theo dõi bot — nhưng auto-fire (T1) là phase riêng cần duyệt
  `copy-trade/**`; tách record khỏi engine để không trộn T1/T3 (§17).

## 3. Bounded specification

**BE** (`backend/src/modules/`):
1. `auth/` (mới): `auth.controller.ts` (`POST nonce/verify/me`), `auth.service.ts`
   (nonce issue/verify signature/cấp token + admin bootstrap từ `ADMIN_WALLETS`),
   `dto/*`, guards `common/auth/*` (`AuthGuard`, `Roles` decorator + `RolesGuard`).
2. `users/` (mới): `User` CRUD tối thiểu (role gán bởi ADMIN, self-register mặc định USER).
3. `audit/` (mới): `AuditInterceptor` + `audit.service.ts` (create-only, không update/delete
   method tồn tại), `GET /api/audit` (ADMIN-only, filter actor/action/vault).
4. `vaults/` (mở rộng, không đổi accounting math): `GET /api/vaults` (list + trader-set),
   `POST /api/vaults` (ADMIN, tạo vault + trader-set), `VaultTrader` assign/remove (ADMIN,
   cap 5/vault); mọi row mang `environment` (default `SANDBOX`).
5. `bots/` (mới, operational record — không execution): CRUD tối thiểu + enable/disable
   + status (ADMIN-only write; read cho USER theo mức public) — đón §4.1, T1 làm sau.
6. Prisma: `User(id, wallet unique, role, createdAt)`, `VaultTrader(vaultId, wallet,
   weightBps, isActive, ...)`, `AuditLog(id, actor, action, target, reason, metaJson,
   createdAt)`, `Bot(id, name, mode, vaultId?, status, ...)`,
   `Vault/CopyOrder += environment`, `Deposit/Withdrawal += userId? FK`;
   migration + client regen.
7. Assert scripts kiểu repo (`assert-*.ts` qua `npx tsx`): RBAC deny matrix
   (401/403 theo deny-list §3.1), audit append-only (thử update/delete → fail),
   multi-vault list, env-guard (production path → từ chối显式).

**FE**: non-goal slice này, trừ types mirror tối thiểu nếu BE contract đổi
(ghi rõ để phase plan không hứa UI login).

**Docs**: `openapi.yaml` (paths mới), `ARCHITECTURE.md` (+RBAC/audit section),
`context-map.json` + indexes refresh (đang stale từ trước — task riêng trong plan).

## 4. Task breakdown (sang phase plan)

- P0: contract (openapi paths mới + DTO/types) + migration models mới (DB local PG 5433).
- P1: `users/` + `auth/` (nonce/verify/guards + admin bootstrap) + deny-matrix asserts.
- P2: `audit/` interceptor + service + ADMIN read API + append-only assert.
- P3: multi-vault read/create + `VaultTrader` set (cap 5) + deposit gắn `userId` +
  `bots/` record + cờ `environment` toàn pipeline.
- P4: smoke full (cũ + mới) + `tsc` + docs/index refresh.
- P5 (tách riêng, cần duyệt): (T1) auto-fire/bot engine — cần approval `copy-trade/**`;
  (T2) treasury policy (reserve/withdrawal window/fee/lock, D+E); (T3) FE auth UI +
  DEMO labels (G: replay/reset/interactive); (H) production transition/custody/
  circuit breaker.

## 5. Test contract

- Runner: repo chưa có test runner → `npx tsx assert-*.ts` (đúng convention hiện tại).
- Cases: verify sai signature → 401; USER → admin route (tạo bot/vault, đổi allocation,
  treasury) → 403; ADMIN op thiếu reason → 400; bootstrap ADMIN lần 2 từ allowlist →
  từ chối (chỉ khi DB chưa có admin); audit row bất biến (update/delete trực tiếp →
  DB từ chối hoặc service không expose); deposit USER mới → shares đúng NAV;
  vault thứ 2 list đúng trader-set riêng; execution `production` → từ chối显式.
- Regression: typecheck BE+FE, smoke envelopes cũ, 4 asserts hiện tại GREEN.

## 6. Agent cards

- Primary: `nestjs-tdd-builder` (P1–P3: failing assert → minimal module → green).
- Gate bắt buộc trước merge: `nestjs-code-reviewer` (key/signature handling,
  guard coverage, mass-assignment role, audit bypass).
- Solution challenge: tự review D1 (wallet-auth vs session-cookie) trong P0, ghi
  decision ngắn — không cần agent ngoài.
- Follow-up: `project-indexer` (module/route/entity index + context-map).

## 7. Decision ledger (ghi thêm vào ADR khi duyệt plan)

- 2026-10-02 / wallet-auth / chọn message-signature, không password — giảm secret surface.
- 2026-10-02 / admin-bootstrap / allowlist `ADMIN_WALLETS` chỉ hiệu lực khi DB chưa có ADMIN.
- 2026-10-02 / rbac-guards / guards ở route layer, service không biết role; deny-list §3.1 vào test.
- 2026-10-02 / audit-append-only / không API/controller path nào được mutate audit (F30: có).
- 2026-10-02 / multivault-join / `vault_traders` thay vì cột array — cho rebalance sau này.
- 2026-10-02 / user-multivault / user được giữ shares nhiều vault (A1).
- 2026-10-02 / env-data-flag / isolation bằng cột `environment`, enforce ở BE (D7, §15).
- 2026-10-02 / bot-record-only / `bots/` slice này chỉ là record operational, engine là T1 riêng (D8, §17).
- 2026-10-02 / allocation-freeze / giữ NAV-sizing Solution v2 — core logic bất biến.

## 8. Protected-file / risk concerns

- `copy-trade/**` — KHÔNG đụng slice này (auto-fire cần approval mới riêng).
- `config/*` + `.env` — không thêm secret (nonce trong DB); nếu P5 cần key mới → hỏi.
- `schema.prisma` + migration — DB local only; nullable FK để không phá E2E cũ.
- `openapi.yaml` — additive-only; FE chưa lock theo contract mới (ghi non-goal).
- Rủi ro chính: gán role tùy ý (mitigate: chỉ ADMIN đổi role, self-register luôn USER;
  test assert); audit bypass (mitigate: interceptor + review gate); nhầm lẫn
  USER funds vs paper vault (mitigate: vault hiện tại vẫn là paper/devnet duy nhất).

## 9. Câu hỏi fund spec (§19) — trạng thái sau intake Rev 2

- Đã chốt: A1 (multi-vault, user nhiều vault), A2 (hard cap 5/vault), allocation
  (giữ NAV-sizing), demo mode (real-time + sim execution), KOL ≈ USER + portfolio
  riêng (E24 tạm chốt), F30 (audit immutable: có).
- Còn treo sang phase sau: A3–A5 (chọn/rebalance/kick trader), B (reserve/dynamic),
  C11–C16 (signal validity/retry), D17–D20 (deposit/withdrawal flow + fee/lock),
  E22–E23+E25 (realized/unrealized, fee model, snapshot), F26–F29 (force cash-out
  approval, principal vs profit, pause/resume semantics, catch-up), G31–G37
  (replay/reset/interactive demo), H38–H43 (sandbox→production transition, custody,
  circuit breaker), §9 treasury policy chi tiết, §15 env isolation mở rộng.

## 10. Next skill

`repo-phase-orchestrator` — viết phase plan + tracker (P0–P4 + P5 tách duyệt) rồi
native execution. Stop khi: tracker đóng + acceptance §1 đủ evidence + review gate pass.
