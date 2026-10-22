# Rule Registry

Source of persisted durable rules for CodexMinimal.

AGENTS.md is the operational rendered view.
This file is the durable rule source.

## Protected Paths

- See `docs/ai/protected-files.md` for critical / sensitive / integration lists.

## Generic Workflow Rules

- Use the smallest suitable skill.
- Route new features through intake before execution.
- Read indexes before broad repository search.
- Keep runtime state aligned with the active plan and tracker.
- Write repeated user-confirmed feedback directly into `Promoted Feedback Rules` below. No separate ledger, strikes, or thresholds.

## Generic Testing Rules

- Run targeted verification before broader checks.
- Keep generated build artifacts out of commits unless explicitly required.
- Typecheck split: `npm run typecheck` (root orchestrator) = BE `tsc -p backend/tsconfig.json` + FE `tsc -p frontend/tsconfig.json`.
- Runtime gates: BE boot smoke (`/api/health`, wallets CRUD incl. 400/404 envelopes, portfolio totals, SSE `CONNECTED`), FE `next build`, split smoke FE:3001 → BE:3000 qua rewrites.

## Active Profile

- See `docs/ai/stack-profile.md` for the current stack profile and allowed profile-specific skills.

## Profile-Specific Rules

### Documentation (plugin-standard)

- `docs/ai/` = AI navigation layer (indexes + context-map + rules). Update after every structural change.
- `docs/architecture/` = system design, ADRs, data-flow.
- `docs/api/` = REST/SSE contract (`openapi.yaml` canonical).
- `docs/setup/` = local env + runbook.
- Root `README.md` = 1-page entry; `SYSTEM_DOCUMENTATION.md` = deep spec (kept, linked from `docs/architecture/`).

### Backend (NestJS runtime)

- Layout: `backend/src/main.ts`, `app.module.ts`, `server/solana.module.ts` (global singleton), `modules/<domain>/{*.controller.ts,*.service.ts,*.module.ts,dto/*.dto.ts}`, `common/`, `config/`.
- Naming: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.dto.ts`, `*.spec.ts`.
- Controllers = thin HTTP/SSE mapping only; business logic in services.
- **tsx-safe DI (bắt buộc): `@Inject(Token)`显式 cho MỌI constructor** — tsx/esbuild không emit decorator metadata nên shorthand `private readonly x: T` nhận `undefined` lúc runtime (tsc vẫn xanh, lỗi chỉ lộ khi boot).
- **tsx-safe validation (bắt buộc): body qua `validateDto(DtoClass, body)`显式 trong controller; query parse thủ công** — global `ValidationPipe` không infer được `@Query/@Body` type dưới tsx (đã gây `perWalletLimit` string + mất default).
- Error envelope `{success:false,message}` giữ nguyên qua `HttpException({success:false,…})` — không để lọt shape Nest mặc định.
- Chain listener singleton duy nhất qua `SolanaModule` global; không provide per-module.
- No cross-module service deep-imports; share via `common/`.

### Frontend (Next.js runtime)

- Layout: `frontend/app/{layout.tsx,page.tsx}`, `frontend/components/`, `frontend/data/`, `frontend/lib/`, `frontend/hooks/`, `frontend/types/`, `frontend/public/`.
- `app/` owns routing only; reusable UI in `components/`; fetch + solana helpers in `lib/`; shared shapes in `types/`.
- FE never imports from `backend/`; contract via `docs/api/openapi.yaml` + `frontend/lib/api.ts` (same-origin base, dev qua `next.config.ts` rewrites → `BACKEND_URL`).
- Styling: Tailwind CSS v4 (`@tailwindcss/postcss`); fonts bằng CSS `@import` trong `globals.css`.

## Safety Rules

- Do not commit `.env` or secrets.
- Do not edit protected files without explicit approval.
- Legacy `src/` + `server.ts` + `vite.config.ts` + `index.html`: REMOVED 2026-09-29 (backup `/tmp/opencode/legacy-backup-20260929.tar.gz`); không còn compat layer.

## Promoted Feedback Rules

<!-- CODEXMINIMAL:PROMOTED_FEEDBACK_RULES START -->
- 2026-09-29 (user-confirmed): Docs follow CodexMinimal plugin standard; source split FE/BE clearly; FE = Next.js spec; BE = NestJS spec.
- 2026-09-29 (user-confirmed pass 2): BE = NestJS runtime thật (không Express thủ công); FE/BE `npm install` riêng; xóa `src/` cũ, giữ thông tin cần thiết cho source mới.
- 2026-10-02: KHÔNG BAO GIỜ sửa migration đã apply — backfill/data-fix luôn bằng migration mới (Prisma checksum drift).
- 2026-10-06 (user-confirmed): Deploy + CI/CD ghi vào `docs/setup/OPERATOR.md`; session mới đọc file này trước, không đoán lệnh.
- 2026-10-06: Structural change (module/route/entity/suite mới) → update `docs/ai` indexes + `context-map.json` ngay trong cùng commit.
- 2026-10-07 (user-confirmed): KOL /trader chỉ giữ Fees + Share + Signals + Payouts (+ xem/request trader); mọi pool ops (settings/rules/pause/remove/basket) là ADMIN-only ở /terminal, khóa cả BE (controller Roles + service guard).
- 2026-10-12 (user-confirmed, SUPERSEDES 2026-10-07): Owner model — KOL toàn quyền trên partner pool của mình (pause/resume kể cả sau kill-switch, listing, tên, slots, maxTraders, add/remove trader, rules); ADMIN giữ fees/settle/applications/rotation. Loss-based gates (kill-switch halt, deposit gate) vẫn chặn entries cho đến khi hồi phục dù status đã resume. /trader render full design mới nhưng không nút ghi nào vượt qua BE assertOwner.
- 2026-10-12 (user-directed, SUPERSEDES manual-settle): nạp/rút của user tự settle ngay ở giá MTM hiện tại (controller gọi settleEpoch sau khi booking; window đóng hoặc lỗi settle → giữ QUEUED như cũ). Settle là tính toán đơn định (giá + mint + HWM ratchet), không cần người duyệt. Endpoint settle tay của ADMIN giữ lại cho override/explicit-NAV. Tiền deposit vào NAV ngay trong cùng epoch (không pha loãng holder); tiền rút ra trừ khỏi NAV đã ghi epoch (không thổi giá cho người ở lại, không sinh fee ma).
- 2026-10-19 (bug rule, pool 14 incident): Mọi đường tiền (requestWithdraw balance-check, settleEpoch payout cap) phải scope theo ĐÚNG ví nạp (`depositor` exact) — cấm union theo session userId (một login nhiều ví đã rút chéo 16.04 SOL, holder shares > supply). Union chỉ được dùng cho hiển thị (`mine()`, history) và slot/ownership gate, không bao giờ cho mint/burn/payout.
- 2026-10-12: Tracked-wallet copy-config (PATCH /api/wallets/:address, gồm deactivate/reactivate) là ADMIN-only (guard + audit); deactivation chỉ dừng ingest (sync + WS unwatch), history giữ lại cho rotation. Pool detail (`GET /api/vaults/:id/pool`) luôn gửi bearer khi có session để myHolding/position hiển thị số thật; ẩn danh vẫn thấy public fields như cũ.
- 2026-10-20 (user-confirmed): Live pipeline scope = trader đang active của pool public/live (`LIVE_SCOPE_MODE=pool`). WS, safety-net RPC sync và PnL stats KHÔNG được chạy cho tracked wallet ngoài pool; leaderboard display có thể giữ topN nhưng không được subscribe/sync. Empty roster fallback DB-active chỉ cho bootstrap/dev.
- 2026-10-20 (user-confirmed): 2 public pool (14 KOL `partner` 75/25, 15 user `basket` 50/50) dùng CHUNG đúng 5 ví, weight bằng nhau 2000bps. Rotation phải pin live trader active và re-sync roster 2 pool mỗi tick; không để drift 3/5/6 ví.
- 2026-10-20 (user-confirmed): Giữ retention **120 ngày** (`FULL_HISTORY_DAYS=120`); không hạ xuống 35 ngày hay thấp hơn nếu chưa có approval mới. Prune scope vẫn chỉ transactions + realtime_events, archive trước khi delete.
- 2026-10-20: WS burst debounce 3s/ví (`LIVE_DEBOUNCE_MS`), SSE flush 500ms với buffer cap 200 (`SSE_FLUSH_MS`), watchdog chỉ resubscribe sau 30 phút im lặng và chỉ subscription change mới arm `lastMsgAt` (không reset mỗi reconcile 60s).
- 2026-10-20: Xoá pool là thao tác phá huỷ — bắt buộc backup dump 12 bảng vault trước; keep-list 14/15; `copy_orders`, `signed_intents`, `bots` phải delete tường minh vì không có FK cascade về vault.
- 2026-10-20 (user-confirmed): Display surface chỉ 5 ví live pool roster. `GET /api/wallets` và `GET /api/portfolio/pnl/overview` phải scope `findAllLive()` (không trả 100 tracked history); `LEADERBOARD_TOP_N=5`, cap=20. Internal jobs vẫn có thể dùng `findAll()`.
- 2026-10-20 (user-approved): Raw `transactions`/`realtime_events` của ví ngoài live roster có thể trim để giảm DB (TRUNCATE keep-5 trong transaction, verify orphan FK=0). Raw chain data re-fetchable; money ledger/orders/audit không nằm trong scope. Luôn ghi counts trước/sau.
- 2026-10-20: Rotation chỉ được activate live pool roster (trừ `LIVE_ROSTER_MODE=top`); không activate top board ngoài roster. Inactive wallet rỗng (không tx/event/open order/active trader) có thể xoá; ví còn open legacy order phải giữ.
- 2026-10-20 (user-confirmed forward-only): FomoScan là nguồn **selection + why-top** (snapshot rank/PnL/trades/win-rate + raw hash). Local chỉ track/copy từ `VaultTrader.enteredAt`; **không backfill 120d** cho trader mới và **không copy** BUY lịch sử. Auto-fire phải dùng `blockTime` + `enteredAt` watermark; `createdAt` chỉ là legacy/demo escape.
- 2026-10-20: Trader rời roster giữ raw tx/events **30 ngày** hoặc đến khi order mở cuối đóng; sau đó archive+audit rồi xoá raw. `copy_orders`, `partner_payouts`, memberships, audit, money ledger không bao giờ bị prune. Natural close là default; fee chia theo active roster tại settle (không phải origin trader).
- 2026-10-20: Master trader performance hiển thị từ Fomo (`source=fomo`), pool performance từ copy orders/local; không trộn hai nguồn. Nếu Fomo lỗi/không có handle → fallback local và ghi source.
- 2026-10-21 (user-approved): Merge `feat/program-vault` vào `main` và deploy lên server hiện tại với `CHAIN_ENABLED=false` trước. Không bind pool 14/15; chỉ bind pool demo riêng khi devnet E2E xong. P4/P5 + mainnet vẫn gated, chưa audit.
- 2026-10-21: Chain demo binding chỉ cho `unlisted` + tên `demo-chain-*`; endpoint initialize/bind từ chối public pools. Deposit browser E2E có thể chạy khi chain loop OFF; keeper/indexer/faucet chỉ chạy khi `CHAIN_ENABLED=true`. Trước demo khách phải dùng dedicated devnet RPC (public RPC rate-limit `getTransaction` 429) và không bật mainnet.
- 2026-10-22: Deposit/withdraw on-chain có **OperationReceipt PDA** (`operation`, kind, vault, user, operation_id); `init` account làm replay cùng operation id fail on-chain. FE lấy `ChainOperation.id` truyền vào instruction; backend vẫn giữ Idempotency-Key/DB unique. Program tests 28/28.
- 2026-10-22: Chain deposit/withdraw dùng **ChainOperation + Idempotency-Key**; create/replay op, submit signature trả 202, indexer cập nhật status PENDING→SUBMITTED→INDEXED/FAILED. Không tạo ledger row lần hai cho cùng tx; không dùng request đồng bộ để chờ chain.
- 2026-10-22: Chain devnet reads/writes dùng **polling public-first** (`DEVNET_PUBLIC_RPC_URL`), fallback Helius chỉ khi 429/5xx/network. `CHAIN_WS_ENABLED=false` mặc định; keeper confirm bằng HTTP polling. Faucet `requestAirdrop` phải dùng public devnet RPC, không dùng Helius; nếu public faucet lỗi, fallback chuyển SOL từ keeper (demo-only). FE gọi `POST /api/chain/pools/:id/sync` sau on-chain tx để cập nhật position ngay.
<!-- CODEXMINIMAL:PROMOTED_FEEDBACK_RULES END -->
<!-- CODEXMINIMAL:PROMOTED_FEEDBACK_RULES END -->

## User Overrides

- 2026-09-29: FE canonical = `frontend/` (Next.js App Router); BE canonical = `backend/` (NestJS modular runtime); legacy đã xóa (pass 2).

- 2026-10-22: On-chain operation id là **random 63-bit** (`onchain_operation_id`, unique BigInt), không dùng DB serial; legacy rows backfill bằng `id` để giữ receipt cũ. FE dùng `operation.onchainOperationId`; DB unique + operation receipt ngăn replay.
