# Phase plan — Solution v2 (Edgepool logic vào source hiện tại)

- Intent: `docs/codexminimal/idsd/2026-09-30-copy-trade-paper-intent.md` + Solution v2
  (`edgepool-core-logic-report.html` §7, chốt 01/10).
- Tracker: `docs/codexminimal/trackers/2026-10-01-solution-v2-tracker.md`
- Nguyên tắc user: fallback "chạy được là được", không over-engineer.
- Inputs còn thiếu (không chặn Phase A): FluxRPC/DataStream keys, MoneyFi model,
  fund vault devnet (P5 cũ vẫn treo).

## Phase map

| Phase | Nội dung | Cần gì thêm |
|---|---|---|
| A1 | Entry immediate + drag + TP params + exposure caps (DB + service) | Không |
| A2 | Manipulation flag job (thuần DB, theo giờ) | Không |
| A3 | Time-stop + kill-switch ngày/tuần (từ CopyOrder + holdings) | Không |
| B1 | Stop ATR + TP regime + shadow-validator | Candles (DataStream keys) |
| B2 | Manage engine (TP ladder/stop/trailing/full-exit auto) | B1 xong |
| C | Vault accounting epoch + HWM/fees (module `vaults/`) | MoneyFi model |
| D | Parser jsonParsed thay DAS → cắt Helius (thuộc migration Flux) | FluxRPC key |

## A1 — Entry + drag + TP params + caps (làm ngay)

DB (`CopyOrder` += migration):
- `entryMode` VarChar(10) default `'immediate'` (`immediate|scaled|patient`)
- `delayDragPct` Decimal(8,4)? — % giá chạy từ master fill tới vault fill
- `tp1Pct` Decimal(8,4)? default 60, `stopPct` Decimal(8,4)? (v1: hằng số, B1 mới ATR)
- `traderTag` = masterWallet đã có (dùng luôn, không thêm cột)

Service (`copy-trade.service.ts` `executePaper`):
- Nhận `entryMode?` (default immediate); `scaled` thì chỉ fire 50% notional và
  ghi note vào `error`? Không — thêm cột `legsJson` JsonB? (giữ đơn giản: v1 chỉ
  support immediate, scaled/patient log warning + fire immediate; engine B2 mới
  chia legs).
- Tính `delayDragPct`: giá master fill (từ `amountUsd`/swap) vs giá vault fill
  (proxy = Jupiter `outAmount` lúc confirm). Thiếu giá → null (không chặn).
- Skip khi `delayDragPct > 25` → FAILED + message rõ (trừ khi `force:true`? Không —
  giữ cứng, đơn giản).
- Exposure caps trước khi fire (đếm CONFIRMED trong 24h qua):
  per-trader (theo `masterWallet`) ≤ 3 lệnh; per-mint (theo `symbol`) ≤ 2 lệnh.
  Vượt → 400 envelope `exposure cap`.
- TP params lưu vào order để Manage dùng sau (B2).

DTO/openapi/FE types: `entryMode?` (+ docs). FE modal: hiển thị drag sau lệnh?
(v1: hiện trong history title; modal giữ nguyên + note TP/stop mặc định.)

Verify: assert script thêm case (cap vượt → 400; drag>25 → FAILED; entryMode
lưu đúng) + `tsc` + API smoke + migrate green.

## A2 — Manipulation flag (thuần DB)

- Job `flag-manipulation.ts` (script chạy tay/cron giờ): với mỗi ví followed,
  pattern `BUY → pump ≥X% trong Y phút → SELL >50%` lặp ≥N lần/30d → update
  `TrackedWallet.isActive=false`? Không tự tắt (nguy hiểm) — v1 chỉ ghi
  `ownerNotes='FLAG:suspected-signal-dump'` + log/alert. Tắt tay sau khi review.
- Verify: chạy trên DB thật, in report top suspects (không đổi data ngoài notes).

## A3 — Time-stop + kill-switch (không cần infra mới)

- Time-stop: job/cron quét `CONFIRMED` quá 24h mà chưa TP1 (v1: không có TP engine
  nên định nghĩa "chưa TP1" = chưa có SELL cùng mint sau đó; ghi cảnh báo vào
  history note). Đơn giản: alert-only v1.
- Kill-switch: tính NAV paper = SOL vault (devnet balance) + Σ paper positions
  (mark theo giá hiện tại khi có, không thì theo notional). Ngày −5% / tuần −15%
  → set gate off tạm (ghi file/DB flag, không đụng env) + alert. v1 alert-only.

## Ghi chú stop-gap

- Trước B1: stop mặc định −30% + kill-switch alert (thay −50% deck).
- Shadow-validator + ATR + TP regime + Manage engine + Vault accounting: sang
  Phase B/C khi có keys/model — không nhồi vào đợt này.

## Stop conditions

- Đỏ `tsc`/migrate/smoke → dừng fix cùng phase.
- Không đụng mainnet, không auto-fire (vẫn 1-click), không sửa `configuration.ts`
  ngoài 3 keys đã duyệt (thêm key mới → hỏi).
