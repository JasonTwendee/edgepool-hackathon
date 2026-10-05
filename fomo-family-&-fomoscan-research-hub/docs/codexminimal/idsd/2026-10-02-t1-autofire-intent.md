# Intent — T1 auto-fire engine (bot AUTO → paper execution)

- Date: 2026-10-02
- Stage: intent-bounded → approved (user duyệt sửa `copy-trade/**` 2026-10-02, đính kèm
  ràng buộc: devnet/paper-only, cấm mainnet, giữ 1-click cũ)
- Parent: fund intent Rev 2 (T1 track), fund spec §§7–8 (target fully automated, default AUTO).
- User decisions T1: poller trong `CopyTradeModule` (không đụng event bus/SSE);
  `Bot.mode` điều khiển (AUTO fire / PAUSED silent); tick thủ công qua endpoint ADMIN.

## 1. Intent contract

- **Intent**: khi master BUY mới xuất hiện trong ledger, bot AUTO tự bắn paper order
  qua đúng pipeline Solution v2 (drag/caps/qualify/slippage/NAV-sizing) mà không cần
  1-click; mọi auto-order ghi `triggeredBy: bot:<id>` + audit row actor tương ứng.
- **Business rules**:
  - Chỉ vault scope: bot có `vaultId` → chỉ fire signal từ `VaultTrader` active của vault đó;
    bot không vault → fallback vault 1 + ví tracked active (ghi rõ trong docs).
  - Mỗi signal chỉ fire 1 lần: dedupe bằng `CopyOrder.masterTxHash`; tick sau skip.
  - Chỉ `BUY` entries; SELL/auto-close là B2-full (deferred, đã ghi).
  - Loop chạy `setInterval` (`COPY_AUTO_INTERVAL_MS`, default 300000; `0` = chỉ tick tay);
    tick concurrent được guard (skip khi tick trước chưa xong).
  - Paper-only tuyệt đối: tái dùng `executePaper` (devnet genesis-check bên trong);
    1-click path cũ không đổi behavior.
- **Non-goals**: mainnet/real execution; auto SELL/close; FE auto UI; đổi gates Solution v2.
- **Constraints**: sửa `copy-trade/**` trong phạm vi duyệt; không sửa `config/*`
  (đọc `process.env` trực tiếp); additive-only openapi; tsx-safe.
- **Acceptance**: AUTO bot + fresh BUY → order CONFIRMED|FAILED (gate đúng) có
  `triggeredBy` + audit `copy.auto_fire`; PAUSED → 0 fire; tick liquidity-blocked →
  errors đếm, không crash; `POST execute` 1-click cũ xanh.

## 2. Decisions

- D-T1.1 poller thay vì subscribe event-bus: không import chéo OnchainModule,
  tái dùng query `watch-signals`, interval điều chỉnh được, manual tick = test hook.
- D-T1.2 first-match bot duy nhất/signal: tránh cap-noise khi nhiều vault trùng trader.
- D-T1.3 `triggeredBy` + `vaultId` qua `PaperOverrides` (không đổi DTO/contract cũ).
- D-T1.4 loop default 5' + env kill (`0`): demo an toàn, audit được mọi auto-fire.

## 3. Bounded spec (BE only, FE sau)

1. `copy-trade.service.ts`: `PaperOverrides += {vaultId?, triggeredBy?}`;
   sizing dùng `vaultId ?? 1`; `quoteJson.sized += triggeredBy`.
2. `auto-fire.service.ts` (mới): `tick(minutes=15, limit=10)` + loop `onModuleInit`;
   `copy-trade.module.ts` += provider + `imports: [AuditModule]` (rule DI).
3. `copy-trade.controller.ts`: `POST /api/copy-trade/auto-fire/tick` (ADMIN+Audit).
4. DTO `AutoFireTickDto`; openapi path + schema; `.env.example` += `COPY_AUTO_INTERVAL_MS`.
5. `assert-autofire.ts` (mocked): no-AUTO/PAUSED/dedupe/fire+triggeredBy+audit/cap-error.
6. Comment `watch-signals.ts`: dry-run vẫn giá trị (pre-flight), engine đã live.

## 4. Test contract

Asserts GREEN + `tsc` + live: tạo bot→vault có trader thật→tick→history có
`triggeredBy` (fired ≥0 honest-report; skips hợp lệ khi không có signal qualify).

## 5. Agents / risks

Primary generic (engine mới, không phải TDD thuần cũng không phải bug);
gate `nestjs-code-reviewer` (loop safety, dedupe race, fund-safety);
follow-up `project-indexer`. Rủi ro: double-fire khi 2 BE chạy (mitigate: dedupe
pre-check + ghi rõ single-writer giả định); loop fire lúc demo (mitigate: PAUSED
mặc định cho bot mới? — KHÔNG, spec default AUTO; mitigate bằng interval 5' + audit).
