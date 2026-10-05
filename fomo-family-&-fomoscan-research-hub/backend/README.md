# Backend — NestJS runtime (`fomo-backend`)

NestJS 12 + `@nestjs/platform-express`, chạy bằng `tsx src/main.ts`.
Contract: `docs/api/openapi.yaml` — mọi response giữ nguyên envelope `{success,…}`.

## Layout

```
backend/
  package.json             deps: @nestjs/*@12, @prisma/*@7, pg, @solana/web3.js
  prisma.config.ts         DB-url single source cho Prisma CLI (build từ POSTGRES_*, DATABASE_URL override)
  prisma/
    schema.prisma          generator + datasource + 3 models đúng sơ đồ tham khảo
    migrations/            SQL migrations (commit cùng code)
  src/
    main.ts                NestFactory bootstrap + global ValidationPipe + CORS
    app.module.ts          imports: PrismaModule (global) + SolanaModule (global) + 5 modules
    database/
      prisma.service.ts    PrismaClient + pg adapter (@Global qua PrismaModule)
      prisma.module.ts
    config/
      configuration.ts     env loader duy nhất (dotenv + process.env)
      solana.config.ts     RPC / commitment / poll / SSE tuning
    common/
      utils/signature.util.ts
      validation/validate-dto.ts   explicit DTO validation (tsx-safe, xem Quy ước)
    server/
      solana.service.ts    SolanaOnChainListenerService (@Injectable, singleton)
      solana.module.ts     @Global() provider — KHÔNG duplicate instance
    modules/
      health/              GET /api/health
      wallets/             CRUD ví (Prisma, DB = source of truth) + copy-config + DTO
      transactions/        Ledger `transactions` (provider, không controller): record/getLedger
      portfolio/           DB-first + RPC backfill (persist rows mới) → shape cũ
      onchain/             poll fan-out + persist `transactions`/`realtime_events`; SSE + GET /events
      copy-trade/          POST /api/copy-trade/execute (SIM-ONLY, protected)
```

Mỗi module: `*.controller.ts` + `*.service.ts` + `*.module.ts` + `dto/*.dto.ts` + `entities/*.entity.ts` (nếu có).

## Database (Prisma 7 + Postgres Docker)

```bash
docker compose up -d postgres          # root repo, fomo-postgres :5433
cd backend
./node_modules/.bin/prisma migrate dev --name <ten>   # đổi schema → migrate + regen client
npm run dev
```

- Runtime kết nối qua `@prisma/adapter-pg`, URL build từ `POSTGRES_*` trong
  `getConfig().db` (khớp `prisma.config.ts`); `DATABASE_URL` optional override cả hai.
- Không auto-sync: mọi đổi schema phải qua `migrate dev` (xem `prisma/migrations/`).
- Seed 10 ví master tự chạy khi bảng rỗng (`WalletsService.onModuleInit`).
- Schema tham khảo (`tracked_wallets` / `transactions` / `realtime_events`, FK CASCADE khi xóa ví)
  khác tên cột với API: mapping tập trung ở `toTrackedWallet()` + `TransactionsService.getLedger()`
  (Decimal→Number, BigInt→Number, `is_active`→`isCopyEnabled`, `created_at`→`addedAt`,
  không có cột avatar). `openapi.yaml` không đổi.
- `allocationWeight` validate `@Max(99.99)` (khớp `NUMERIC(4,2)`) — tránh 500 từ DB.

## Chạy

```bash
cd backend
npm install
npm run dev        # tsx src/main.ts → http://localhost:3000
npm run typecheck  # tsc --noEmit -p tsconfig.json
npm run build      # tsc -p tsconfig.build.json → dist/ (chạy: npm start)
```

## Quy ước (bắt buộc — do tsx/esbuild không emit decorator metadata)

- Mọi constructor DI dùng `@Inject(Token)`显式 — không bao giờ dùng shorthand
  `private readonly x: T` trần (sẽ nhận `undefined` lúc runtime dù tsc vẫn xanh).
- Body validate显式 bằng `validateDto(DtoClass, body)` trong controller
  (global `ValidationPipe` chỉ là lớp 2 cho tsc builds; dưới tsx nó không infer được type).
- Query string parse thủ công (`parsePortfolioQuery`) — không dùng class DTO cho `@Query()`.
- Controller không chứa logic; service không đọc `req/res`.
- Không import chéo service giữa modules; chain client duy nhất qua `SolanaModule` global.
- Env chỉ qua `config/configuration.ts`.
- Lỗi trả envelope `{success:false,message}` qua `BadRequestException/NotFoundException/…({success:false,…})` — không để lọt shape Nest mặc định.
