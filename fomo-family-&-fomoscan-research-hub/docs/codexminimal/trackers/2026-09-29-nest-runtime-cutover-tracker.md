# Tracker — Pass 2: BE → NestJS runtime, FE → Next.js runtime, xóa legacy

- Topic: nest-runtime-cutover-delete-legacy
- Started/Closed: 2026-09-29
- Workflow: nestjs-refactor-guardian (classify refactor → impact map → approval (user explicit) → smallest coherent units → verify → indexes → log)
- Rollback boundary: `/tmp/opencode/legacy-backup-20260929.tar.gz` (src/, server.ts, vite.config.ts, index.html, public/, package.json, tsconfig.json)

## Impact map (thực tế)

- Moved (giữ thông tin cần thiết): `src/components/*` (9, real code) → `frontend/components/*` (ghi đè wrappers); `src/data/*` (2) → `frontend/data/`; `src/types/fomo.ts` → `frontend/types/fomo.ts`; `public/*` (2) → `frontend/public/` (move, không regen).
- Deleted: `src/`, `server.ts`, `vite.config.ts`, `index.html`.
- BE: Express factories → `@Controller/@Injectable/@Module`, DTO interface → class, `SolanaModule` global, `@Sse` Observable, `main.ts` → `NestFactory` + ValidationPipe + CORS; xóa `common/filters` + `common/pipes`, thêm `common/validation/validate-dto.ts`; `backend/package.json` + install (Nest 12 stack).
- FE: `frontend/package.json` (Next 16) + install, `next.config.ts` (rewrites), `postcss.config.mjs`, `.env.example`, Metadata layout, `api.ts` `NEXT_PUBLIC_API_URL`.
- Root: `fomo-monorepo` orchestrator (scripts `--prefix`), prune deps thừa (`motion`, `@google/genai`, `bs58`, vite, react…).
- Imports changed: FE `../data`, `../types` (giữ nguyên relative, vẫn đúng vị trí mới); BE singleton → DI.
- Routes: giữ nguyên 8 routes + envelopes (verify 400/404/500 shape).
- Protected: `copy-trade/**` chỉ đổi cấu trúc, không đổi logic sim-only; `.env` untouched; `public/*.html` move không regen.

## Lỗi thật đã gặp & fix (durable rules)

1. tsx/esbuild không emit decorator metadata → DI `undefined` (crash `onModuleInit`): fix `@Inject()`显式 mọi constructor.
2. Cùng nguyên nhân → global `ValidationPipe` skip transform `@Query/@Body` (`perWalletLimit` string, mất default): fix `validateDto()`显式 + `parsePortfolioQuery` thủ công.
3. `next build`: import `./globals.css` sai (phải `../globals.css`); `turbopack.root` pin gây lỗi `extends ../tsconfig.json` → bỏ pin, giữ warning benign; `next.config.ts` tránh `import.meta` (lỗi `exports is not defined`) → dùng `process.cwd()`… cuối cùng bỏ luôn (không cần).

## Verification (tất cả xanh 2026-09-29)

- `npm run typecheck` (root → BE + FE tsc) ✅
- `next build` (3 routes `/`, `/_not-found`, TS pass) ✅
- Nest boot: 8 routes mapped ✅; `GET /api/health` ONLINE ✅; wallets total=10 ✅; POST invalid → 400 `{success:false}` ✅; POST `{}` → 400 ✅; POST sai type → 400 ✅; DELETE unknown → 404 ✅; portfolio `limit=2` → total=20, `perWalletLimit`:2 number ✅; `limit=abc` → fallback 25/total=250 ✅; SSE `CONNECTED` (prefix `id:`) ✅; copy-trade sim ✅
- Split smoke: FE:3001 `/` → 200, `/api/health` + portfolio qua rewrites ✅

## Close

- Done. Docs sync: AGENTS.md, rule-registry, stack-profile, project-index, architecture-notes, setup, READMEs, api README, context-map, refactor-log (entry mới).
- Rủi ro còn lại: RPC public 429 (fallback bù đủ số lượng — đã verify); workspace-root warning của Next (benign); chưa có test runner (`*.spec.ts` — xem test-index).
