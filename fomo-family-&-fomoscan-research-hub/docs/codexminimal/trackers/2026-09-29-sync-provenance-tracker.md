# Tracker — Pass 5: polling 1 phút + provenance + fix fill va chạm

- Topic: sync-1m-provenance-fill-fix
- Started/Closed: 2026-09-29

## Hệ thống hiện tại (trả lời câu hỏi user)

- Boot seed 10 ví (PnL/winRate tĩnh) → `OnchainService.onModuleInit` start poll 8s
  (sample 2 ví/kỳ, chỉ sig mới qua `until: lastSig`) + persist tx/events.
- Portfolio DB-first + backfill RPC theo nhu cầu (mở ví nào mới bù ví đó).
- Ví ít tx vì: poll miss (429/sample), backfill on-demand, cap 25/ví.
- Seed tĩnh vì `cumulative_pnl_usd`/`win_rate` không gì cập nhật; sidebar badge
  "seed" khi ví có 0 cặp buy→sell.

## Thay đổi

- `SyncService` (module `sync` mới): mỗi 60s (`SYNC_INTERVAL_MS`) full-sync 25 tx
  TẤT CẢ ví + `PnlService.syncWalletStats()` recompute từ pairs thật (guard overlap,
  lỗi theo ví, log `[SyncScheduler]`).
- `source: 'rpc' | 'synthetic'` end-to-end (interface ×2, persist `raw_payload.eventSource`,
  API, FE type, openapi): Solscan link + đầy đủ chỉ cho `rpc`; `synthetic` badge "sim", không link.
- Fix 2 bug fill: (1) seed `wIdx*100` không wallet-scoped → va chạm PK, ledger kẹt;
  (2) generator cũ chỉ có 58 outputs (modulo-58) + index âm sinh chuỗi "undefined"
  (sig 136 ký tự, rớt VARCHAR) → `generateWalletScopedSignature` (FNV+xorshift, đủ 88 ký tự).
- Xóa `generateFallbackStandardHistory` (dead code) + `generateRealisticSignature` thừa ở utils.
- Reclassify 104 rows cũ qua Helius batch (13 real, 91 synthetic) rồi xóa synthetic;
  sync lại từ sạch.

## Verify (xanh 2026-09-29)

- BE tsc ✅. Boot sync: 204 rows mới, 25/25/ví (250 total), statsUpdated 10/10.
- Interval steady-state newTx=0 (không dup). Breakdown: 46 rpc + 204 synthetic, nhãn đúng.
- API `source` counter ✅, FE live 200 ✅.
