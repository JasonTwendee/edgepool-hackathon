# Intent — Dynamic allocation (weights + rebalance)

- Date: 2026-10-02
- Stage: intent-bounded → execution (user duyệt dynamic allocation paper-only 2026-10-02)
- Parent: core allocation (A6–A10), fund spec §6.

## 1. Intent contract

- **Intent**: moi vault chia budget sizing (1% NAV hien tai) cho traders theo
  weight dong — weight tu paper track-record, rebalance dinh ky + audit.
- **Business rules** (score xep hang, tranh scale $ tuyet doi):
  - Input: closed paper orders 30d theo masterWallet (wins/losses/realized).
  - `winRate01` (n<3 → 0.5 neutral) + `pnlRank01` xep hang realized trong vault.
  - `score = 0.6*winRate01 + 0.4*pnlRank01` → bps ti le, floor 500 / cap 4000,
    chuan hoa ve 10000.
  - Sizing: `traderCap = sizedCapUsd * weightBps/10000` (vault 1 trader = legacy
    full 1%); vault khong traders → share 1; master ngoai set → share 1 (manual).
  - Rebalance: tick tay `POST .../allocation/rebalance` (ADMIN+Audit) + loop
    `COPY_ALLOC_INTERVAL_MS` default **0** (manual-first: doi weight anh huong
    moi lan fire sau — admin bat loop khi tin).
  - Paper-record limitation (ghi ro): dung onchain-skill weighting la follow-up
    (can share portfolio data qua common/, hien cam deep-import).
- **Non-goals**: onchain-skill weights, per-mint allocation, auto-rebalance mac dinh
  bat, UI weights (shape co san).
- **Acceptance**: matrix score (neutral/rank/clamp/chuan hoa); rebalance ghi dung +
  audit; sizing slice dung (equal-5 → 0.2% NAV moi); legacy (no traders) y cu;
  live rebalance tong 10000.
- **Constraints**: copy-trade/* + contract; paper-only; tsx-safe.

## 2. Decisions

- D-G1 rank-based thay tuyet doi (mien nhiem scale PnL $M vs $K).
- D-G2 neutral khi <3 closed orders (chong noise vault moi).
- D-G3 loop default OFF (allocation la quyet dinh nhay cam — manual truoc).
- D-G4 out-of-scope = legacy full (ton trong manual override).

## 3. Bounded spec

1. `allocation.service.ts` (mới, copy-trade module): `scoreTraders()` pure export +
   `rebalance(vaultId)` + loop `onModuleInit`.
2. `executePaper`: weight slice trong sizing (fail-open ve legacy khi thieu data).
3. Controller `POST /api/copy-trade/allocation/rebalance` (ADMIN+Audit) + DTO.
4. openapi path (additive). `.env.example` += `COPY_ALLOC_INTERVAL_MS="0"`.
5. Asserts: scoring matrix + rebalance writes/audit + sizing slice + legacy.
6. Live: rebalance vault that → tong 10000 + fire slice trong sized note.

## 4. Test/agents/risks

Primary generic; gate reviewer. Rui ro: paper record mong (mitigate: neutral guard);
weight lam nho fire dot ngot (mitigate: loop off default + audit + hien thi lich su
weights qua audit log).
