# Intent — TP ladder + trailing-stop (paper legs)

- Date: 2026-10-02
- Stage: intent-bounded → execution (user duyệt trailing/ladder paper-only 2026-10-02)
- Parent: T1-B2 manage; Solution v2 TP ladder/trailing (deferred tới nay).

## 1. Intent contract

- **Intent**: positions paper đóng theo thang: TP1 chốt một phần → phần còn lại
  trailing-stop theo peak / TP2 chốt hết / stop/time-stop đóng phần còn lại —
  realized cộng dồn theo legs, audit từng leg.
- **Business rules** (constants, chưa per-order config):
  - `TP1_SHARE = 50%` @ move ≥ tp1 (default 60); fill theo giá target (quy ước backtest).
  - `TRAIL_PCT = 20%`: kích hoạt sau khi TP1 đã chốt; đóng phần còn lại khi
    move ≤ peakMove − 20 (fill market).
  - `TP2 = 2×tp1`: đóng phần còn lại @ target2.
  - STOP (`−stop`) và TIME_STOP (24h) đóng toàn bộ phần còn lại @ market.
  - SELL paper (short proxy): mirror qua move đã signed theo direction.
  - Idempotent: order `closedAt` set chỉ khi remaining = 0; tick chỉ quét mở.
- **Non-goals**: per-order ladder config, trailing trước TP1, FE legs UI (shape có
  sẵn cho dashboard sau), ladder trên swap thật.
- **Acceptance**: TP1 partial → remaining 50% + realized 1 leg; pullback 20% từ peak
  → trail close; TP2 full; stop/time đóng remainder; chạy lại không đổi; audit đủ legs.
- **Constraints**: chỉ `copy-trade/*` + migration; paper-only; tsx-safe.

## 2. Decisions

- D-L1 legs = bảng riêng `CopyOrderLeg` (queryable, thay vì nhét quoteJson).
- D-L2 TP fill @ target (quy ước backtest), stop/time/trail @ market (thực tế).
- D-L3 history item kèm `legs` (additive; openapi paper-history chưa mô tả shape
  paper từ trước — ghi nợ, không sửa contract cũ).
- D-L4 constants thay vì per-order config (bounded; config hóa ở phase sau nếu cần).

## 3. Bounded spec

1. Prisma: `CopyOrderLeg(id, orderId FK CASCADE, leg, fraction, exitPriceUsd?,
   realizedPnlUsd?, closedAt?)` + `@@unique([orderId, leg])` + relation `CopyOrder.legs`;
   migration.
2. `manage.service.ts`: `evaluateOne` → legs flow (remaining, fills, peak, closes,
   audit/leg); `toOrderShape`? — legs map ở `listHistory` (copy-trade.service).
3. `assert-manage.ts` += legs cases (giữ cases cũ xanh).
4. Live: tick → summary; regression 10 asserts + tsc; review gate.

## 4. Test/agents/risks

Primary generic; gate reviewer (leg math, remaining, idempotency). Rủi ro: target-fill
vs market (ghi rõ quy ước trong code + docs); orders cũ không legs (remaining=1,
tự tạo leg ở lần fill đầu — tương thích).
