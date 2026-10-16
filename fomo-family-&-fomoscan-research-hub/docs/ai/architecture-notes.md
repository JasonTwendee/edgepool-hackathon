# Architecture Notes

Durable architecture facts and decisions.

## Decisions

| Date | Decision | Reason | Impact |
|---|---|---|---|
| 2026-09-29 | Split monolith into `frontend/` (Next.js App Router spec) + `backend/` (NestJS modular spec) | User requires clear FE/BE + framework specs; legacy `src/`+`server.ts` mixed concerns | New code goes to canonical dirs; legacy = compat only |
| 2026-09-29 | Docs → CodexMinimal plugin standard (`docs/ai/`, `docs/architecture/`, `docs/api/`, `docs/setup/`) | User requires plugin-standard docs | `README.md` = entry, `SYSTEM_DOCUMENTATION.md` retained + linked |
| 2026-09-29 | `docs/api/openapi.yaml` = API source of truth | FE/BE drift risk (250-tx ledger, SSE, wallets CRUD) | BE DTOs + FE `lib/api.ts` must match |
| 2026-09-29 | Cutover runtime thật: BE Express → NestJS 12 (`NestFactory`, DI, `@Sse`), FE Vite → Next.js 16 (App Router, rewrites `/api` → BE); xóa `src/` + `server.ts` + `vite.config.ts` + `index.html` | User yêu cầu refactor BE sang Nest + npm install FE/BE + xóa src cũ | Root thành orchestrator `fomo-monorepo`; `backend/` + `frontend/` tự chứa package; legacy chỉ còn trong `/tmp/opencode/legacy-backup-20260929.tar.gz` |
| 2026-09-29 | Reference schema 3 bảng (`tracked_wallets`/`transactions`/`realtime_events`, FK CASCADE, Prisma migrations): portfolio DB-first + RPC backfill, poll persist tx+events+cursors, API shape giữ nguyên qua mappers | User đưa sơ đồ DB tham khảo | Portfolio hội tụ về pure DB reads; DELETE ví cascade lịch sử; `allocationWeight` guard 99.99 |
| 2026-09-29 | Poll loop 8s (2 ví/sample, new-sig) + SyncScheduler 60s (full 25 tx mọi ví, recompute stats) | Ví ít tx do poll miss + backfill theo nhu cầu; seed tĩnh không tự đổi | `SYNC_INTERVAL_MS` (env); stats = realized khi đủ pairs, seed + badge khi chưa |
| 2026-09-29 | tsx-safe DI/validation: `@Inject()`显式 mọi constructor; `validateDto()`显式 cho body; query parse thủ công | tsx/esbuild không emit decorator metadata → DI `undefined`, ValidationPipe transform bị skip (lỗi thật đã gặp) | Ghi thành quy ước bắt buộc trong `backend/README.md` + rule-registry |
| 2026-10-05 | Tracked universe = FomoScan rotation (topN=30, cap=50, Solana-only verified); drop → deactivate giữ history | Sync loop skip inactive; rotation tick throttle FomoScan ≥1.1s (sponsor 60 req/min; batch POST 403 → single GETs) | Sidebar rank-sort qua `isActive` API; `modules/leaderboard/*` |
| 2026-10-05 | Global login wall: seeded admin/user/kol (scrypt), wallet multi-provider; không public registration | Terminal dời về `/terminal` (admin); pool app là main surface | `LoginModal`, `POST /api/auth/login|purge`, failed-login audit |
| 2026-10-06 | Pool model: 1 pool = 1 vault + 1 AUTO bot + 3–5 traders; NAV theo trader trades qua MTM engine | Fee 20% HWM → 80 depositors / 15 partner / 5 Edgepool (basket 10/10) | Pool app P1–P5 (`/`, `/pools/[id]`, `/portfolio`, `/trader`); Calm + `?view=advanced` |
| 2026-10-06 | Paper/sandbox only: shares sổ off-chain, claim ghi sổ, executor chặn mainnet bằng devnet genesis-check | Tiền thật cần custody + on-chain vault + mainnet executor (phase Product) | KOL claim sandbox; payout wallet verify ownership trước khi set |
| 2026-10-06 | Public URL cố định qua reverse proxy; deploy chỉ khi CI xanh | SSOT vận hành: `docs/setup/OPERATOR.md`; rolling prune 35d có archive | quick-tunnel ephemeral đã bỏ; audit/orders/vaults không prune |

## Boundaries

| Boundary | Rule | Notes |
|---|---|---|
| FE ↔ BE | HTTP REST + SSE only, via `docs/api/openapi.yaml` | FE never imports `backend/` |
| BE modules | 17 modules own controller+service+dto; chain client singleton via global `SolanaModule` | Share via `common/` + `config/`; never provide listener per-module; controller dùng `@Audit()` phải import `AuditModule` |
| Legacy | REMOVED 2026-09-29 (`src/`, `server.ts`, `vite.config.ts`, `index.html` deleted; backup `/tmp/opencode/legacy-backup-20260929.tar.gz`) | Không còn compat layer |
| Secrets | `backend/.env` + `frontend/.env` never committed; examples canonical | RPC/Jito/vault keys via `backend/src/config/`; FE env public-only |

## Integration Constraints

| Integration | Constraint | Notes |
|---|---|---|
| Solana RPC | `SOLANA_RPC_URL`, `confirmed` commitment, 8s poll, 2-wallet sample/cycle | See `backend/src/modules/onchain/` |
| Helius (optional) | `HELIUS_API_KEY` empty = disabled | `health` reports `heliusEnabled` |
| SSE | `GET /api/onchain/stream` (`@Sse` Observable): `CONNECTED` + `ONCHAIN_SWAP_EVENT`, 15s `PING` data (Nest không emit comment), dòng `id:` tự tăng | FE `EventSource` bỏ qua `PING`; xem `docs/api/openapi.yaml` |
| Copy-trade | Legacy sim + devnet paper 1-click (protected) | Statuses PENDING→QUATED→SENT→CONFIRMED\|FAILED; Qualify+size gates; see intent `2026-09-30-copy-trade-paper` |

## Data Layer Split (2026-10-02, verified live)

| Source | Role | Notes |
|---|---|---|
| FluxRPC eu (`SOLANA_RPC_URL`) | Head reads + WS + send | Sub-100ms; ledger cache only ~70s (`firstAvailable` ≈ current−170) — NOT for history |
| Helius (`HELIUS_API_KEY`) | History backfill + DAS enrich (bodies/prices) | Load-bearing for anything older than ~1 min; keep until archive plan exists |
| Lantern `:8899` (`LANTERN_URL`, read-path only) | Cached account reads (0.5ms hit) | `cache_requests:true`; breaks WS upgrade → never for subscriptions; BE uses it in holdings only |
| DataStream `data.fluxbeam.xyz` (keyless today) | Bulk prices, candles, ATR/stop math, shadow backtests | `RUGCHECK_API_KEY` used by Qualify gate (`/v1/tokens/{mint}/report`) |
| CoinGecko (keyless) | Majors ticker via BE proxy `/api/market/ticks` | FE never holds keys |

## Ops Lessons (2026-10-02)

- Never `pkill -f <pattern>` (matches own shell) — kill by PID; relaunch with
  `setsid nohup … & disown`.
- `tsx -e` forbids top-level await — use script files.
- tsx-safe DI: injectables must have no-arg constructors (ParamDecorator-less
  params crash Nest boot with UnknownDependenciesException).
- BE/FE run as compose services (`fomo-backend`, `fomo-frontend`); code changes
  need `docker compose build + up -d` (no watch mode in containers).
- Workdir paths containing `&` break naive shell `cd` — prefer absolute paths.
