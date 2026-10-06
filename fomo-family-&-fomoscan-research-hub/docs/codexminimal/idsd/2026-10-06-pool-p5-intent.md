# Intent — Advanced view (P5)

- Date: 2026-10-06
- Stage: intent-bounded → execution (user: nốt đi)
- Parent: design handoff Advanced + pool-math ladder/rules.

## 1. Bounded spec

1. BE: `poolDetail` += `advanced` (behind same route): KPIs (unrealized,
   deployedPctNav, fromHwmPct, pnlPeriod), risk (day/week loss % vs -5/-15,
   signals24h, emergencyExits7d), positions += ladder (entry/tp1/tp2/stop/
   trailFloor/current/hit flags), exposure += capPct (share of 2% cap).
2. FE `/pools/[id]?view=advanced` + header Calm/Advanced toggle (pool page only):
   deposit bar, KPI tiles, chart + risk bars, positions table with ladder viz,
   exposure + execution log.
3. Asserts + openapi note + live verify.

## 2. Non-goals

Editable rules UI (partner portal covers settings), new engine logic.
