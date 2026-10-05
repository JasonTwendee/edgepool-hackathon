# Intent — ATR stop + TP regime (auto-tune per signal)

- Date: 2026-10-02
- Stage: intent-bounded → execution (user duyệt ATR core paper-only 2026-10-02)
- Parent: core logic (Solution v2 B1 con lai), fund spec §6 (risk management).

## 1. Intent contract

- **Intent**: stop/TP/trail mac dinh suy tu volatility (ATR 1h) thay hang so
  -30%/60%/20 — moi paper order tu-tune theo mint, thieu nen thi fallback cu.
- **Business rules** (regime table, RR 1:2 neo tren ATR stop):
  - `stop = clamp(2×atr%, 8, 40)` (ham co san, giu nguyen).
  - `tp1 = clamp(2×stop, 20, 120)`; `trail = clamp(stop, 10, 30)`; tp2Mult giu 200.
  - `regime = calm (<1%) | normal (1–3%) | wild (>3%)` — luu quoteJson de doi chieu.
  - Auto-tune chi khi DTO khong truyen显式 tp1/stop (1-click custom luon thang);
    `autoTune=false` tat han (ve 60/30/20). Thieu nen/feed loi → fallback + note.
  - Manage khong doi (doc fields tren order) — regime chay qua order da tune.
- **Non-goals**: ATR trailing dong (trail van % co dinh sau tune), per-candle regime
  update (tune 1 lan luc fire), FE regime UI.
- **Acceptance**: matrix regime (calm/normal/wild/fallback); order tune dung so +
  note; explicit thang fallback; live mint co nen tune that; 60/30 cu khi tat.
- **Constraints**: chi `common/market` (static moi) + `copy-trade/*` + contract;
  paper-only; tsx-safe.

## 2. Decisions

- D-A1 neo RR 1:2 tren ATR-stop (don gian, giai thich duoc; khong ML).
- D-A2 explicit-wins + autoTune flag (fallback path luon ton tai, demo on dinh).
- D-A3 tune 1 lan luc fire (khong drift theo thi truong — tranh doi luat giua tran).

## 3. Bounded spec

1. `datastream.service.ts` += `suggestRegime(candles)` static (+ interface).
2. DTO `autoTune?: boolean` (default true).
3. `executePaper`: regime block sau sizing; order create dung effTp1/effStop/effTrail;
   `quoteJson.sized.tune`; `PaperOverrides market` Pick += 'candles'.
4. openapi execute DTO += autoTune (+ note).
5. Asserts: regime matrix (datastream +cases) + tune/explicit/fallback (paper-executor
   +cases) + stubs candles o autofire/paper harnesses.
6. Live: 1-click khong tp/stop tren mint co nen → order tune that + tick manage.

## 4. Test/agents/risks

Primary generic; gate reviewer. Rui ro: mint memecoin khong nen 1h (mitigate:
fallback + UNKNOWN o manage nhu cu); DataStream cham (mitigate: fail-open, paper
van fire voi defaults).
