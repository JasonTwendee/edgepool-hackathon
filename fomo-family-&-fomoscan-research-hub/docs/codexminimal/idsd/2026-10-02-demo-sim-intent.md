# Intent — Demo Simulator (seed/replay/reset + bot PnL)

- Date: 2026-10-02
- Stage: intent-bounded → execution (module mới, không sửa protected code)
- Parent: đề xuất demo đã duyệt (trader/portfolio thật, bot fake, flow là chính).

## 1. Intent contract

- **Intent**: 1 click có bộ demo sạch kể trọn story (seed vốn → replay N trades thật
  thành orders simulated → manage đóng → settle epoch → bot PnL), demo lại được
  bằng reset, ledger thật không hề hấn.
- **Business rules**:
  - Prefix mark: vault/bot `demo-*`, deposit `depositor:'demo'`,
    order `quoteJson.sized = {demo:true, triggeredBy:'demo:<botId>'}`.
  - Seed: vault + bot AUTO + 3 ví tracked active + deposit 100 + settle NAV 100.
  - Replay (days=7, limit=30): master BUYs thật (có mint, asc) → executePaper
    confirm:true bằng **simulated executor** (không broadcast devnet — đúng bản chất
    simulation, tiết kiệm thời gian/vốn) → manage.tick() → force-close remainder
    dạng TIME (scratch theo giá hiện tại, không đoán) → settle 1 epoch
    (NAV = vốn + realizedUsd/solPrice, fallback giữ vốn).
  - Deposit demo lần 2 (sau settle đầu): nạp thêm ở giá mới → minh họa mint shares
    không retro-profit.
  - Withdraw demo: chỉ tạo withdrawal request → DỪNG ở QUEUED + trả thông báo
    "lệnh rút tiền đang chờ xử lý ở epoch tới" (user chốt 2026-10-02) — KHÔNG settle
    withdrawal này trong replay (để audience thấy cơ chế pending).
  - Reset: xóa business rows demo (vault/bot/deposit/epoch/traders/orders+legs),
    GIỮ audit + append row `demo.reset` (bất biến audit không phá).
  - Performance: aggregate theo triggeredBy (counts, realized, winRate, equity series).
  - Manual-trigger only (không loop): operator điều khiển nhịp demo.
  - Withdraw demo dừng ở QUEUED + notification (không auto-settle để demo).
- **Non-goals**: deterministic PnL (giá live → mỗi run khác nhau, honest-report),
  loop auto-replay, FE Demo tab (shape sẵn, slice sau), đụng ledger/rows thật.
- **Acceptance**: seed → replay N → performance có số → reset sạch (trừ audit);
  rows thật nguyên vẹn; asserts + live smoke; audit đủ 4 actions.
- **Constraints**: chỉ module `demo/` mới + contract; gọi services có sẵn (không sửa
  copy-trade/vaults/audit code); tsx-safe.

## 2. Decisions

- D-M1 simulated executor thay devnet proof (replay là simulation, không đốt dust).
- D-M2 remainder force-close TIME-scratch (story luôn hoàn tất, không treo HOLD).
- D-M3 reset giữ audit (append-only bất khả xâm phạm).
- D-M4 manual-only (operator-driven cadence, không loop ngầm).

## 3. Bounded spec

1. `demo/` module: `demo.service.ts` (seed/replay/reset/performance) +
   `demo.controller.ts` (4 endpoints ADMIN+Audit) + DTOs + `demo.module.ts`;
   `app.module.ts` += DemoModule. Replay gồm deposit2 + withdraw-pending.
2. openapi 4 paths + schemas (additive).
3. `assert-demo.ts` (mocked full flow).
4. Live smoke (ADMIN): seed → replay days=7 limit=10 → performance → reset →
   verify + audit còn.

## 4. Test/agents/risks

Primary generic; gate reviewer. Rủi ro: replay orders lẫn với auto-fire trong
history (mitigate: triggeredBy `demo:` riêng + query filter); settle NAV USD→SOL
(mitigate: fallback giữ vốn, ghi rõ).
