# Launch runbook — NHÁNH ANALYST (hệ thống phân tích)

Phạm vi: biến cụm research hiện tại (FOMOScan/wallet tracking/signals) thành hệ
analyst dùng được độc lập — không cần dòng tiền thật vẫn có value.
Đọc chung: `LAUNCH_RUNBOOK.md` (hub). Nhánh còn lại: `LAUNCH_RUNBOOK_PRODUCT.md`.

## A0 — Nền dữ liệu (đọc prod-grade)

- [ ] RPC archive tier (Flux archive hoặc giữ Helius cho history — Flux chỉ giữ ~70s)
- [ ] DataStream keyed tier: bật ATR tune thật, bỏ fallback keyless (Owner: BE)
- [ ] Lantern prod cho holdings/prices (WS giữ RPC trực tiếp — đã chốt, chết WS nếu ngược)
- [ ] Chính sách retention: realtime_events/transactions giữ bao lâu, purge job
- [ ] Pass: 7 ngày portfolio/history khớp, 0 ws errors

## A1 — Chất lượng tín hiệu (độ tin cậy analyst)

- [ ] ATR đa khung (1m + 1h) + regime meme/majors cho stop/TP (hiện fallback)
- [ ] Shadow-validator: mọi signal đều có paper-watch + drag đo được trước khi rank
- [ ] Manipulation flags mở rộng (hiện 3 ví tagged) + wallet-cluster phát hiện ví phụ
- [ ] Ranking realized risk-adjusted (Sharpe/win-rate/maxDD) — KHÔNG brand copyable-score
- [ ] Pass: backtest 30d win-rate đo được, MAE cải thiện vs baseline đã ghi (shadow +10%)

## A2 — UX analyst + API

- [ ] TraderProfile/thesis/swaps: watchlist, alert theo ví, comparative view
- [ ] API cho analyst ngoài: key + quota + openapi đã có 41 paths (thêm gói subscription sau)
- [ ] KOL leaderboard flywheel: lãi → xếp hạng → follower (đúng report §4, không cần tiền thật)
- [ ] Pass: analyst ngoài dùng API key tạo được watchlist + nhận alert E2E

## A3 — Vận hành đọc (scale rẻ)

- [ ] Cache/bulk-first cho holdings, symbol cache, candle backfill (đã có — siết SLA)
- [ ] Status page công khai: RPC lag, sync delay, stale flags
- [ ] Demo-sim thành sandbox training cho analyst mới (seed/replay/reset có sẵn)
- [ ] Pass: p95 API < 500ms, status page xanh 30 ngày

## Không thuộc nhánh này

- Mọi thứ chạm tiền (vault on-chain, mainnet fire, payout) → nhánh Product
- Hai nhánh dùng chung: auth/roles, audit append-only, FE shell, policy engine
