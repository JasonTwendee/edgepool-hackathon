# Tracker — Solution v2 (Edgepool logic vào source)

- Topic: solution-v2
- Plan: `docs/codexminimal/plans/2026-10-01-solution-v2-phase-plan.md`
- Started: 2026-10-01
- Statuses: `open` → `in_progress` → `done` | `blocked`

## Phases

- [x] A1 entry/drag/TP-params/caps: `done`
  (DTO+openapi+FE types ✅; service caps/drag-skip/entryMode/tp-stop ✅;
  asserts ALL GREEN ✅; migrations applied ✅; `tsc` + `build` ✅;
  BE container rebuilt (code A1 live) + smoke: drag-skip/cap/confirm/history ✅)
- [x] A2 manipulation flag: `done`
  (`flag-manipulation.ts`: selftest GREEN, noise guards + 2h basis age;
  3 suspects tagged to ownerNotes via --write ✅; `tsc` ✅)
- [x] A3 time-stop + kill-switch (alert-only): `done`
  (`paper-watch.ts`: stale-CONFIRMED list + 24h stats + vault balance ✅;
  2 FAILED rows = unfunded-vault attempts (đúng lifecycle); `tsc` ✅)
- [x] B1 ATR/shadow/TP-regime (data clients): `done`
  (`DataStreamService` prices/candles + ATR/stop math, asserts GREEN;
  `shadow-momentum.ts` selftest GREEN + live 25 signals: hit 52%/0.9' MAE −14%,
  report saved → ủng hộ entry-immediate;
  `RugCheckService` + qualify + cache 24h, asserts GREEN, spike live $PUMP/$SOL ✅)
- [x] B2 Manage: `done` (shadow positions entry/peak/close/realized columns;
  manage backfills entry + closes TP1/STOP, order #5 HOLD +0.4% live ✅;
  auto-close trên swap thật để sau — dust-proof không có gì để đóng)
- [x] Qualify wiring vào paper: `done`
  (`tokenMint` plumbing DTO→DB→FE modal; RugCheck gate strict/lenient;
  order #5 live CONFIRMED với qualify $PUMP thật ✅; fixed tsx-DI no-arg rule)
- [x] Market proxy + ticker BE: `done` (`/api/market/ticks|prices` live ✅;
  FE ticker qua proxy; Lantern service compose + configurator 200)
- [x] NAV→Size + slippage/liquidity gates: `done`
  (copy=min(master,1% NAV,0.1 SOL,cap) auto-scale + sized record; slippage +
  mcap gates strict; asserts GREEN)
- [x] Pipeline dry-run: `done` (`watch-signals.ts`: 22 signals → 7 WOULD-FIRE,
  $GcEe blocked Low Liquidity ✅, cap $12.15 từ vault NAV; auto-fire vẫn OFF)
- [x] FE history close/realized: `done` (`:3001` 200 ✅)
- [ ] D parser thay DAS: `blocked`
  (parser + validator viết xong; PHÁT HIỆN CHẶN: FluxRPC tier chỉ giữ ~70s
  tx history (oldestSlot ≈ current−174) → getTransaction/getTransactionsForAddress
  quá 1 phút đều 404. Helius là load-bearing cho mọi history/bodies.
  Quyết định: giữ Helius cho history (dual-run chính thức), FluxRPC cho head
  reads, Lantern cho cached account reads. Cắt Helius hẳn cần plan to hơn.)
- [x] C vault accounting: `done`
  (MoneyFi model nhận 02/10 → BE `vaults/` live: deposit/settle/withdraw/HWM-fee,
  asserts GREEN incl. anti-dilution, E2E alice/bob/withdraw/over-reject ✅;
  design doc `VAULT_CONTRACT_DESIGN.md`; FE `VaultCard` live `:3001` ✅)
- [ ] D parser thay DAS (thuộc migration Flux): `open`
- [x] Lantern read-path: `done`
  (BE holdings qua `LANTERN_URL`, WS giữ FluxRPC; symbol cache; smoke 1105
  tokens/145 priced ✅, 0 ws errors)
- [x] Holdings giá DataStream + backfill candles: `done`
  (bulk-first + helius fallback; heal pass candle 1H cho rows unpriced)
- [x] B2 Manage: `done` (alert + persist evaluation vào quoteJson; auto-close
  không áp dụng được cho dust-proof paper — ghi rõ giới hạn)
- [ ] D parser thay DAS: `blocked`
- [ ] D parser thay DAS (thuộc migration Flux): `open`

## Handoff log

- 2026-10-02 (Lantern): config qua API (key+eu+cache_requests+QUIC), READY;
  RPC :8899 verified (getAccountInfo cached 0.5ms vs 702ms direct).
  BE-switch thử rồi REVERT: WS upgrade qua Lantern bị 200 → onLogs chết.
  Hướng đúng: Lantern chỉ cho read-path (holdings/prices), WS giữ FluxRPC trực tiếp.

- 2026-10-02 (Flux cutover): keys RPC+RugCheck lưu local-only; `SOLANA_RPC_URL`
  → FluxRPC eu, container rebuild, smoke xanh (health/wallets/sim/history).
  DataStream prices/candles mở không key (SOL live); RugCheck report live.
  Helius key còn → DAS enrich vẫn chạy (dual-run de facto); Helius RPC hết dùng.

- 2026-10-01: Solution v2 chốt 6/6 ý. Plan viết từ report §7. Bắt đầu A1.
- Treo ngoài plan: P5 E2E (chờ fund vault), Flux keys, MoneyFi model.
