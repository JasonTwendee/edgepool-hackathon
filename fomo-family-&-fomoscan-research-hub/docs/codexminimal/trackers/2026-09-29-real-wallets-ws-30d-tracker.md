# Tracker — Pass 6: ví FOMO thật + WS/polling 30d + pager FE

- Topic: real-wallets-ws-30d-pagination
- Started/Closed: 2026-09-29

## Phát hiện then chốt (trả lời tại sao ví ít history)

- 8/10 địa chỉ cũ stale: RPC trả về **0 signature** (verify trực tiếp).
  Chỉ Unipcs + Frogman trùng với leaderboard FOMO thật.
- User cung cấp 10 ví leaderboard thật (kèm totalPnL, avatar, followers...) →
  thay toàn bộ seeds, TRUNCATE reseeding, sync lại từ sạch.

## Kiến trúc dữ liệu mới (đúng yêu cầu "1p poll → parse → DB, 30d, notify, stream+poll")

- **WS event stream** (`SolanaStreamService`: `onLogs`/ví + watchdog resub 120s) là
  nguồn realtime chính → enrich Helius → persist → SSE fan-out → FE chuông.
- **RPC polling safety-net** (`SyncService` 60s + `HistorySyncService`): paginate
  30d/cap 1000/ví (deep tới khi đủ cũ, sau đó incremental theo cursor),
  retry/backoff 4 lần, overlap-guard, boot non-blocking.
- **Helius enrich** batch + DAS mint cache: action/symbol/amount/venue thật từ
  fund flow; cells thiếu giá → amountUsd undefined (trung thực).
- **PnL/chart 30d**: `GET /pnl?days=` + `series` realized; FE chart dùng series BE.
- **FE phân trang server**: `page/pageSize/action/days`, 10/trang + pager UI;
  range tabs 24H/7D/30D/ALL → days 1/7/30/90.
- Xóa hẳn synthetic (DB + code + UI badge/link-disable); source chỉ còn rpc/helius.

## Verify (xanh)

- BE/FE tsc ✅, `next build` ✅, openapi parse ✅ (9 paths).
- Reseed 10 ví (9 avatar thật), sync đầu 59 txs thật; ledgers hội tụ dần theo RPC.
- WS 10 subs active, watchdog armed; restart không seed trùng (cursor + PK dedup).
