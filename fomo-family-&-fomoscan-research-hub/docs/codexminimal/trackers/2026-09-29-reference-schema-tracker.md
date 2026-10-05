# Tracker — Pass 4: Reference schema 3 bảng + persistence hoàn thiện BE

- Topic: reference-schema-persistence
- Started/Closed: 2026-09-29
- Input: sơ đồ DB tham khảo của user (`tracked_wallets` / `transactions` / `realtime_events`).

## Quyết định thiết kế

- Triển khai schema **nguyên bản**: snake_case qua `@map`, NUMERIC/BIGINT/TIMESTAMPTZ/JSONB đúng sơ đồ, FK `wallet_address → address`, `tx_signature → signature`, `ON DELETE CASCADE` (xóa ví = xóa lịch sử — đã ghi vào ADR/architecture-notes).
- API **giữ nguyên** (`openapi.yaml` chỉ +`GET /events` mới): mapping tập trung
  (`toTrackedWallet`, `getLedger`): `is_active`→`isCopyEnabled`, `allocation_weight`→`allocationWeight`,
  `cumulative_pnl_usd`→`totalPnlUsd`, `win_rate`→`winRate`, `created_at`→`addedAt`,
  Decimal/BigInt→Number, **bỏ avatar** (check FE: không render avatar live-wallet).
- Portfolio **DB-first + RPC backfill**: mỗi request persist rows mới → hội tụ về pure DB reads.
- Poll persist qua **internal subscriber** (SSE subscribers giữ pure broadcast); lỗi persist log, không crash loop.
- `allocationWeight` guard `@Max(99.99)` (khớp `NUMERIC(4,2)`) → 400 thay vì 500 DB.
- Migration: baseline cũ (1 bảng shape TypeORM) bị lệch sau khi xóa file → `migrate reset`
  (chỉ DB dev `fomo_dev`, seeds tái tạo) với consent显式 + `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`,
  baseline mới `init-reference-schema`. Ghi rõ: KHÔNG bao giờ reset trên prod.

## Verify (xanh 2026-09-29)

- BE + FE tsc ✅; `prisma validate/generate` ✅; `\d` khớp sơ đồ (columns/types/FK cascade) ✅.
- Boot → seed 10 (shape API cũ, không leak `id`) ✅.
- `portfolio?limit=3` → total 29, 29 rows trong `transactions` ✅.
- Poll live → 3 `realtime_events` (title/payload/FK đầy đủ), `GET /api/onchain/events` ✅.
- Restart → 10 ví + 29 tx (không seed trùng) ✅; add/PATCH/DELETE ✅; guard 999 → 400 ✅; cascade xóa tx ✅.

## Docs sync

- `openapi.yaml` (+`RealtimeEvent`, `GET /api/onchain/events`), `docs/api/README.md`,
  `frontend/lib/api.ts` (+`listRealtimeEvents`), `backend/README.md`,
  `architecture-notes.md`, `context-map.json`, `refactor-log.md`.
