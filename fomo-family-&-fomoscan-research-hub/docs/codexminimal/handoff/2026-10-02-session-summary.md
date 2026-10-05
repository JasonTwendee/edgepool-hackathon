# Session summary — 2026-09-30 → 2026-10-02 (paste vào session mới để lấy context)

## Sản phẩm đang chạy (tất cả local, docker compose project `fomo`)

| Service | Port | Trạng thái |
|---|---|---|
| FE `fomo-frontend` (Next 16) | :3001 | 200, Edgepool skin, VaultCard + Copy history live |
| BE `fomo-backend` (NestJS 12) | :3000 | ONLINE, RPC = FluxRPC eu |
| PG `fomo-postgres` | :5433 | DB `fomo_dev`, migrations tới `copy_orders_shadow` + `vault_accounting` |
| Lantern `fomo-lantern` | :8080 configurator, :8899 RPC | READY, `cache_requests:true`; chỉ dùng cho read-path (làm chết WS) |

## Đã build trong session (theo thứ tự)

1. **Terminal UI rebuild** theo `docs/setup/DESIGN.md` (5-block → 4-block sau khi bỏ cột phải rồi phục hồi): `FomoHeader` (search `/`, Paste, edgepool lockup SVG), `FomoLeftSidebar` (leaderboard ví thật + Add/Remove, timeframe gộp vào chart), center `TraderProfile` (hero PnL, top-trades, positions, thesis, swaps), `FomoRightPanel` (Send demo + Copy + Positions + History + VaultCard), `FomoBottomTicker` (CoinGecko → BE proxy `/api/market/ticks`).
2. **Edgepool brand reskin 100%**: Nocturne tokens, Inter Tight/Inter/JetBrains Mono, `@phosphor-icons/react` (gỡ lucide), logo/favicon/avatar chính chủ (`frontend/public/brand/`), chart aqua + gridlines, nút outline-aqua.
3. **Copy-trade paper** (intent + phase plan + tracker đầy đủ): `POST execute` (sim cũ + paper 1-click), lifecycle PENDING→QUATED→SENT→CONFIRMED|FAILED, Jupiter quote + dust-proof devnet, gate/cap/confirm envelopes, `GET history`, TDD asserts GREEN, **E2E order #4 CONFIRMED sig `5RYRk…8RJTraN8A5` finalized**.
4. **Solution v2 (report §7)**: entry immediate + drag-guard >25% skip, exposure caps (3/trader, 2/mint/24h), TP1 60/stop 30 params, NAV-sizing `min(1% NAV,0.1 SOL,cap)` auto-scale, slippage + mcap gates, shadow positions (entry/peak/close/realized), `watch-signals.ts` dry-run, manipulation flag (3 ví đã tag notes), paper-watch, vault accounting MoneyFi (deposit/settle/withdraw/HWM-fee, E2E alice/bob ✅), `VAULT_CONTRACT_DESIGN.md` (doc only).
5. **Flux migration**: keys RPC+RugCheck local-only; RPC → FluxRPC eu; DataStream keyless (prices/candles/ATR/shadow); RugCheck Qualify wired (order #5 $PUMP live ✅); Lantern configured; market proxy; holdings qua Lantern + bulk-first + symbol cache + candle backfill.
6. **Research**: `edgepool-core-logic-report.html` (9 sections + calculator) + Solution v2 chốt 6/6 + shadow report (momentum +10%: hit 52%/0.9', MAE −14% → ủng hộ entry-immediate).

## Quyết định đã chốt với user (đừng hỏi lại)

- Devnet paper-trade, 1-click (không auto-fire), full DB+UI; protected `copy-trade/**` + `.env` secrets: APPROVED.
- Copyable-score: bỏ khỏi messaging. Pullback-wait: bỏ, múc luôn. TP1 giữ 60%.
- Multi-trader vault 3–5, cap 2 lớp (20% exposure budget + 2%/mint) + kill-switch ngày 5%/tuần 15%.
- Fallback "chạy được là được", không over-engineer. Helius giữ cho history (FluxRPC tier chỉ giữ ~70s ledger — đã đo).
- Vault = local wallet (chưa code on-chain). Vault local hiện tại pubkey `6Qbrp…9N5pM`, 5 devnet SOL (secret trong `backend/.env`, đã bàn giao user).

## Còn treo (cần user hoặc phase sau)

- BE restart cần quyền root của user (mình dùng `docker compose` được, `kill` root process không).
- FluxRPC archive endpoint? (hỏi sponsor; nếu có mới cắt Helius hẳn).
- DataStream key riêng (hiện keyless vẫn chạy).
- MoneyFi model: đã nhận đủ để build Phase C (không còn block).
- Lantern BE-switch toàn phần: REVERTED có lý do (chết WS) — chỉ dùng read-path.
- B2-full auto-close trên swap thật, on-chain vault (cần audit + vốn thật).

## Quy ước vận hành (đã ghi vào `docs/ai/architecture-notes.md`)

- Kill process theo PID, relaunch `setsid nohup … & disown`; không `pkill -f`.
- tsx-safe: injectable constructor không tham số; `tsx -e` cấm top-level await.
- Mọi đổi code BE/FE phải `docker compose build + up -d` rồi smoke lại.
- Secrets: chỉ trong `backend/.env` (không commit), không bao giờ in ra chat/log.
- Trackers: `docs/codexminimal/trackers/2026-09-30-copy-trade-paper-tracker.md`,
  `2026-10-01-solution-v2-tracker.md`; intent, plans, telemetry, artifact-registry,
  current-work.json đều đã cập nhật.
