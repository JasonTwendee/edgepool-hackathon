# Intent — T1-B2 manage auto-close (paper positions)

- Date: 2026-10-02
- Stage: intent-bounded → execution (user duyệt auto-close paper 2026-10-02)
- Parent: fund P5-T1, Solution v2 B2 + A3 (time-stop), `manage-paper.ts` v1.
- Nền có sẵn: columns close đã tồn tại (entry/peak/exit/closeReason/closedAt/
  realizedPnlUsd); v1 script đã đánh giá + đóng shadow thủ công.

## 1. Intent contract

- **Intent**: engine tự quét positions paper CONFIRMED còn mở, backfill entry,
  track peak, tự đóng khi chạm TP1/stop/time-stop 24h — ghi realized PnL + audit
  `manage:auto_close`. Paper-only, không di chuyển fund.
- **Business rules**:
  - Đánh giá mỗi position: entry (có sẵn → dùng; chưa → candle 1m đầu tiên sau
    createdAt) → move% theo direction (BUY +1 / SELL −1) → TP1_HIT (≥tp1, default 60)
    / STOP_HIT (≤−stop, default 30) / TIME_STOP (mở >24h, đóng theo giá hiện tại
    hoặc entry khi mất giá) / HOLD / UNKNOWN (thiếu giá → bỏ qua, không đoán).
  - Đóng = full close duy nhất (không ladder/trailing-partial: paper không giữ
    position thật để chia legs — ghi rõ quyết định).
  - realized = move% × notional (amountUsd), làm tròn cent; peak cập nhật mỗi tick.
  - Đóng rồi không bao giờ mở lại (idempotent: chỉ quét `closedAt == null`).
  - Loop `COPY_MANAGE_INTERVAL_MS` (default 300000, `0` = tick tay); guard concurrent.
- **Non-goals**: trailing-stop, TP ladder partial, auto-close trên swap thật (B2-full
  on-chain — cần vốn + audit, phase khác), đổi công thức evaluate().
- **Acceptance**: TP1/stop/time-stop đóng đúng + realized đúng + audit actor manage;
  UNKNOWN không đụng row; chạy lại không đổi gì; live tick honest-report.
- **Constraints**: chỉ `copy-trade/*` + contract + env-example; paper-only; tsx-safe.

## 2. Decisions

- D-B2.1 promote logic v1 (evaluate/move/peak/close) nguyên công thức — không phát
  minh lại toán đã review.
- D-B2.2 full-close-only (paper legs là hư cấu kế toán).
- D-B2.3 TIME_STOP = 24h theo A3 (alert-only cũ giờ thành close + audit).
- D-B2.4 audit actor `manage:auto_close`, target `order:<id>`.

## 3. Bounded spec

1. `manage.service.ts` (mới): `tick()` + loop `onModuleInit`; module wiring
   (+exports cho test sau).
2. Controller: `POST /api/copy-trade/manage/tick` (ADMIN+Audit `copy.manage_tick`);
   DTO reuse `AutoFireTickDto`? Không — viết `ManageTickDto` riêng? Dùng chung shape
   minutes/limit là đủ nhưng tách DTO rõ nghĩa hơn: `ManageTickDto` (giữ đơn giản,
   copy 6 dòng).
3. openapi path + `ManageTickResult`; `.env.example` += `COPY_MANAGE_INTERVAL_MS`.
4. `assert-manage.ts` (mocked ds/prisma/audit): evaluate matrix + backfill + peak +
   3 loại close + realized + idempotent + audit rows.
5. Live: tick → summary; regression (9 asserts + smoke nhanh); review gate.

## 4. Test/agents/risks

Asserts GREEN + tsc + live honest-report. Primary generic; gate reviewer
(PnL math, idempotency, fund-safety). Rủi ro: giá DataStream stale → close sai giá
(mitigate: UNKNOWN khi thiếu giá; close ghi exitPriceUsd显式 để đối chiếu sau).
