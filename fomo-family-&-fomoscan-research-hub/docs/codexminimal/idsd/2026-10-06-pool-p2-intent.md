# Intent — Pool detail Calm (P2)

- Date: 2026-10-06
- Stage: intent-bounded → execution (user: phang tiếp P2)
- Parent: design handoff pool detail Calm + pool-math.ts.

## 1. Bounded spec

1. BE gates in `deposit()`: min 0.5 SOL + slots (full blocks NEW depositors;
   existing holders add freely). Slots used = distinct settled depositors.
2. `GET /api/vaults/:id/pool` (public, optional auth → myHolding + masked flag):
   pool fields + pnl(4) + navSeries (epochs t/v) + open positions (MTM via
   DataStream) + signals (recent 20 orders → pipeline steps) + log (recent
   closes/fails) + exposure per trader (%NAV) + slots + myHolding + masked
   (holding < 0.5 → mask tokens/traders/sizes).
3. FE `/pools/[id]`: back link, paused banner, eyebrow/name/desc/rule chips,
   PnL card + chart + side stats, positions, signals chips, basket, side
   My position + Deposit panel (min, ≈shares, terms).
4. Asserts + openapi + live verify.

## 2. Non-goals

Advanced view (P5), Portfolio (P3), partner portal (P4), cancel withdrawal (P3).
