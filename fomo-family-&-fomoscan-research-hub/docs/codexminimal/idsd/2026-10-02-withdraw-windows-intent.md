# Intent — Withdrawal windows (settle theo lich)

- Date: 2026-10-02
- Stage: intent-bounded → execution (vaults/*, khong protected)
- Parent: T2 treasury, fund spec D18 (instant vs window).

## 1. Intent contract

- **Intent**: vault co the bat che do settlement window — deposit/withdraw luc nao
  cung queue duoc, nhung settle chi chay trong window mo; ngoai window → 400 kem
  thoi diem mo ke tiep. Mac dinh tat (tuong thich cu).
- **Business rules**:
  - `settlePeriodHours` (0 = luon mo) + `settleLengthMin` (>0 khi bat); neo window
    theo `Vault.createdAt` (don gian, deterministic, khong can cron).
  - Trong window: `cyclePos = (now - createdAt) % period < length` → settle cho phep.
  - Ngoai window: settle → 400 `Settlement window closed — next opens at <iso>`.
  - Request deposit/withdraw khong bi gate (queue cho window sau) — chi settle gate.
  - Status tra ve `window: {open, nextOpensAt, periodHours, lengthMin} | null`
    (null khi tat).
  - Policy set qua endpoint cu (mo rong DTO) — ADMIN + audit nhu T2.
- **Non-goals**: cron tu settle, window theo lich am/duong phuc tap, nhieu window/ngay,
  bypass ADMIN (settle hien public — giu nguyen, P5 gating rieng nhu da ghi).
- **Acceptance**: tat → settle nhu cu; bat (period 24h/length 60m, vault moi) → mo;
  length 0 → dong + 400 co nextOpensAt; mo lai → settle xanh; asserts + live.
- **Constraints**: chi vaults/* + migration + contract; tsx-safe.

## 2. Decisions

- D-W1 neo createdAt thay cron/lich: khong ha tang moi, deterministic de test.
- D-W2 chi gate settle (request van queue) — dung ngu nghia batch window D18.
- D-W3 opt-in default 0 (giong reserve: tuong thich truoc, ADMIN bat khi can).

## 3. Bounded spec

1. Prisma: `Vault += settlePeriodHours Int @default(0), settleLengthMin Int @default(0)` + migration.
2. `VaultService`: `windowState(vault)` (pure helper, export de test) + gate trong
   `settleEpoch` + `status()` += window + `setPolicy` += 2 fields (validate:
   period 0..8760, length 0..1440; length>0 doi period>0).
3. DTO `VaultPolicyDto` += 2 fields; openapi VaultPolicy schema += 2 fields.
4. `assert-windows.ts` (mocked): tat/open/dong/next + settle gate + legacy.
5. Live (ADMIN): bat window mo → settle ok; length 0 → 400 co next; tat → settle ok.

## 4. Test/agents/risks

Primary generic; gate reviewer. Rui ro: dong ho lech giua tinh toan (mitigate: dung
Date.now duy nhat moi lan goi); vault cu createdAt lau → cycle van dung (modulo).
