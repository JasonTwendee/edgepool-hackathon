# Architecture — FOMO Family & FOMOScan Research Hub

> Canonical: `frontend/` (Next.js App Router spec) + `backend/` (NestJS modular spec).
> Legacy compat: `src/` + `server.ts` (deprecated, do not extend).
> API source of truth: `docs/api/openapi.yaml`.

## 1. System overview

Real-time on-chain wallet tracker + transaction intelligence (Solana Mainnet):

- Listen trực tiếp on-chain (RPC `getSignaturesForAddress`, poll 8s, sample 2 ví/cycle).
- Ledger 250 giao dịch chuẩn (25 tx/ví × 10 ví), sort `slot` desc.
- Full Base58 signatures (88-char), slot, blockTime, token (`$SOL $WIF $POPCAT $MEW $BONK…`), USD, venue (Phoenix CLOB / Titan Meta-DEX / Raydium / Orca).
- Dynamic wallet tracking (`POST /api/wallets` → listen ngay).
- SSE realtime (`GET /api/onchain/stream`).
- Copy-trade: legacy sim + devnet paper 1-click (module `copy-trade`, protected;
  paper = Jupiter quote read-only + dust devnet proof, `copy_orders` lifecycle,
  never mainnet).

Chi tiết domain: xem `SYSTEM_DOCUMENTATION.md` (root, giữ nguyên) + `DATA_FLOW.md`.

## 2. Logical architecture

```
Solana Mainnet-Beta
  │ RPC JSON-RPC / WebSocket (confirmed)
  ▼
backend/ (NestJS-spec, Express core)
  ├─ src/main.ts + app.module.ts
  ├─ modules/health/        GET /api/health
  ├─ modules/wallets/       CRUD ví + copy-config
  ├─ modules/portfolio/     GET /api/portfolio/transactions (25/ví)
  ├─ modules/onchain/       GET /api/onchain/stream (SSE) + poll loop
  ├─ modules/copy-trade/    POST /api/copy-trade/execute (sim-only)
  ├─ server/solana.service.ts  SolanaOnChainListenerService (canonical)
  └─ config/ + common/
  │ HTTP REST + SSE (openapi.yaml)
  ▼
frontend/ (Next.js App Router spec)
  ├─ app/layout.tsx + app/page.tsx (tab router)
  ├─ components/* (9 sections)
  ├─ lib/api.ts + lib/sse.ts + hooks/*
  └─ types/* (mirror BE DTOs)
```

## 3. Backend modules (NestJS spec)

| Module | Controller | Service | DTO |
|---|---|---|---|
| health | `health.controller.ts` | `health.service.ts` | — |
| wallets | `wallets.controller.ts` | `wallets.service.ts` | `CreateWalletDto`, `UpdateWalletDto` |
| portfolio | `portfolio.controller.ts` | `portfolio.service.ts` | `PortfolioQueryDto` |
| onchain | `onchain.controller.ts` | `onchain.service.ts` | — (SSE events typed) |
| copy-trade | `copy-trade.controller.ts` | `copy-trade.service.ts` | `ExecuteCopyDto` |

Rules: controller thin-only; service owns logic; DTO validates every write; share via `common/`; config via `config/` (never hardcode RPC).

Full NestJS runtime = `npm i @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs class-validator class-transformer` rồi chuyển `main.ts` sang `NestFactory` (xem `backend/README.md`).

## 4. Frontend (Next.js App Router spec)

| Path | Role |
|---|---|
| `frontend/app/layout.tsx` | Root layout, fonts, metadata, theme |
| `frontend/app/page.tsx` | `/` tab switcher (overview, vault-spec, fomo-family, fomoscan, explorer, risks) |
| `frontend/components/*` | Presentational sections (spec wrappers, re-export legacy) |
| `frontend/lib/api.ts` | Typed REST client (khớp `openapi.yaml`) |
| `frontend/lib/sse.ts` + `hooks/useOnchainStream.ts` | SSE subscribe |
| `frontend/types/*` | `fomo.ts` + `onchain.ts` (mirror BE) |

Rules: `app/` routing-only; không import `backend/`; contract qua `openapi.yaml`.

Full Next.js runtime = `npm i next@15` + `next.config.ts` (xem `frontend/README.md`).

## 5. Data-flow & realtime

Xem `DATA_FLOW.md`. Tóm tắt: poll → `lastSignatures` → `OnChainTransactionEvent` → SSE `ONCHAIN_SWAP_EVENT` → toast + ledger prepend.

## 6. ADRs

- `ADR-001-fe-be-split.md` — vì sao tách FE/BE + spec-first thay vì big-bang rewrite.

## 7. Fund roles/auth (2026-10-02, intent Rev 2)

- Identity = Solana wallet + message-signature (`auth/`: nonce TTL 5' → verify
  ed25519 zero-dep → opaque bearer token sha256, session 7d). Không password/JWT dep.
- RBAC = `AuthGuard` (401) + `RolesGuard` (403) trên route; `OptionalAuthGuard` gắn
  identity cho routes legacy public (deposit/withdraw) mà không phá demo ẩn danh.
- Roles: `USER` (xem + deposit/withdraw) / `KOL` (+portfolio riêng, cùng công thức NAV
  shares) / `ADMIN` (operational + override). Deny-list §3.1 vào deny-matrix assert.
- Admin bootstrap: `ADMIN_WALLETS` (local-only env) chỉ hiệu lực khi DB chưa có ADMIN.
- Audit = `audit/` interceptor + service create-only, bảng `audit_logs` append-only;
  audit fail không phá op chính (warn). Đọc: `GET /api/audit` (ADMIN).
- Multi-vault: `VaultTrader` join (cap 5 active/vault, soft-remove), `Bot` record-only
  (AUTO/PAUSED, không engine), `Vault.environment` (`SANDBOX` default; `PRODUCTION`
  create/execution từ chối显式 — env isolation enforce ở BE, D7).
- Routes cũ giữ public slice này (demo tương thích); siết settle/deposit → quyết định P5.
- Quy tắc DI mới (đã gãy boot 1 lần): module nào có controller dùng
  `@UseInterceptors(AuditInterceptor)` phải `imports: [AuditModule]`.

## 8. FE fund — auth + admin + demo (2026-10-02, T3)

- `types/fund.ts` mirror openapi (User/Audit/Bot/Vault/policy/tick); `lib/api.ts`
  += authed fetch (token `fomo.session` trong localStorage) + 15 client fns.
- `AuthPanel`: nonce → message → paste-signature → verify (+ paste-token dev,
  logout xóa); session lift lên `page.tsx`, restore qua `/api/auth/me`.
- `AdminPanel` (overlay, 5 tabs users/audit/vaults/bots/engine): CRUD vaults/traders/
  policy/bots/tick + set role; 403 hiện message BE nguyên văn.
- `DemoBanner` tĩnh mọi trang (§§11–13); `VaultCard` badge sandbox + treasury/policy note.
- Tradeoff: localStorage token (demo-ok; production → httpOnly cookie, follow-up).

## 10. Auth transport — cookie + browser wallet (2026-10-02)

- Dual Bearer + httpOnly cookie `fomo_session` (HttpOnly/Path/SameSite-Lax/7d;
  Secure opt-in `COOKIE_SECURE=1`); guards doc Bearer truoc, cookie sau.
- `POST /api/auth/verify` tra kem Set-Cookie; `POST /api/auth/logout` revoke row +
  clear cookie. CSRF production can token rieng (follow-up).
- FE: `credentials:'include'` mọi authed call; login bang vi browser (`window.solana`
  injected, zero-dep, fallback paste-signature); AdminPanel gate write theo role
  (UX — authz that o BE).

## 9. Copy-trade automation — auto-fire + manage (2026-10-02, T1/B2)

- `AutoFireService` (poll `COPY_AUTO_INTERVAL_MS` 5', kill `0`): BUY mới trong vault
  trader-set của bot AUTO → `executePaper` (confirm:true programmatique) + dedupe
  `masterTxHash` + `triggeredBy: bot:<id>` + audit. Tick tay `POST .../auto-fire/tick`.
- `ManageService` (poll `COPY_MANAGE_INTERVAL_MS` 5', kill `0`): backfill entry (candle
  1m), track peak, full-close TP1(60)/STOP(30)/TIME_STOP(24h) + realized + audit
  `manage:auto_close`. Idempotent; UNKNOWN không đụng row. Tick tay `POST .../manage/tick`.
- Ladder (2026-10-02): legs trong `copy_order_legs` — TP1 50% @target, TP2 remainder
  @2×tp1, TRAIL 20% pullback từ peak (kích hoạt sau TP1), STOP/TIME remainder @market;
  SELL mirror; history item kèm `legs`.
- Settlement windows (2026-10-02): `settlePeriodHours/settleLengthMin` opt-in,
  neo `createdAt`, chỉ gate settle (request vẫn queue), 400 kèm nextOpensAt.
- ATR regime auto-tune (2026-10-02): stop=clamp(2×atr,8,40), tp1=clamp(2×stop,20,120),
  trail=clamp(stop,10,30), RR 1:2; tune-once lúc fire, explicit-wins, fallback 60/30/20.
  Live tune chờ DataStream history depth (keyless trả 2 nến).
- Dynamic allocation (2026-10-02): score rank-based từ paper track-record 30d
  (0.6 winRate + 0.4 pnlRank, neutral khi <3 orders), floor 500/cap 4000 (cap n≥3),
  chuẩn hóa 10000bps; sizing slice budget 1% NAV theo weight (fail-open legacy);
  rebalance tick tay + loop OFF mặc định, audit đầy đủ.
- Demo Simulator (2026-10-02): seed (vault+bot+traders+deposit+settle) → replay
  signals thật thành orders simulated (simulated executor, cap 3/ví) → manage +
  force-close TIME → deposit2 + settle → withdraw QUEUED pending + notification;
  performance theo bot; reset xóa business rows (giữ audit). Manual-only.
- Cả hai paper-only (qua `executePaper`, devnet-check bên trong); 1-click cũ giữ nguyên.


## Paper sizing and epoch NAV

- Paper order `amountUsd` records the copied allocation, not the source trade.
  Budget remains `min(source USD, 1% NAV, 0.1 SOL, max USD)`, sliced by trader
  weight and floored to cents. The 2% mint gate uses remaining principal after
  filled legs plus the new allocation. Quote input uses that allocation in
  lamports and targets `tokenMint` (USDC fallback when omitted). Quotes and the
  devnet self-transfer proof still do not execute real swaps.
- Cumulative paper PnL is realized leg PnL plus unrealized PnL on remaining
  principal. USD PnL is converted with the current wSOL/USD mark; this is a
  paper accounting convention, not reconciliation to actual wallet balances
  or historical swap fees/fills.
- `vault_epochs.pnl_sol` records the cumulative PnL already included in NAV.
  Automatic pre-settle NAV = last post-settle NAV + queued deposits + current
  cumulative PnL SOL minus the previous PnL baseline. Missing SOL/token prices
  or entry prices refuse settlement instead of silently omitting positions.
- Settlement reads the latest checkpoint and queue under the per-vault
  Postgres advisory transaction lock. Post-settle NAV subtracts performance
  fees and gross redeemed share value; withdrawal fees are booked separately
  in treasury. Loss gates use share-price returns when available, excluding
  deposit/withdraw cash flows; historical records without share prices retain
  the NAV fallback.
- Apply the additive migration `20261008000000_epoch_pnl_baseline` and regenerate
  Prisma before using this code. Historical epochs have a NULL baseline.
  If confirmed orders already existed at their checkpoint, automatic settlement
  refuses until an ADMIN reviews balances and submits an explicit `navSol`.
  That override must include queued deposits and exclude previously redeemed
  capital; it establishes the baseline while executing queued settlement.
  No automatic migration or rewrite of historical balances is performed.
- Regression evidence: [paper position asserts](../../backend/src/common/accounting/assert-paper-position.ts)
  and [isolated Postgres verification](../../backend/src/modules/vaults/verify-accounting-postgres.ts).
  Run the latter from `backend/` with `POSTGRES_HOST=localhost`,
  `POSTGRES_PORT=55433`, and test credentials/database via `POSTGRES_*`, then
  `npx --no-install tsx src/modules/vaults/verify-accounting-postgres.ts`.
  The script refuses non-local databases and names without `_test` suffix.
