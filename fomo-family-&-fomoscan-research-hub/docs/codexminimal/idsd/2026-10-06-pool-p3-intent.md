# Intent — Portfolio (P3)

- Date: 2026-10-06
- Stage: intent-bounded → execution (user: triển tiếp)
- Parent: design handoff Portfolio + withdraw modal.

## 1. Bounded spec

1. BE `GET /api/portfolio/overview` (auth): per-pool mine + openCount + flat flag
   + totals (value/deposited/withdrawn/returns) + my exposure per open position
   (size × my share fraction) + pending withdrawals (with nextCheckpointAt)
   + history (deposits + withdrawals across pools, newest first).
2. `DELETE /api/vaults/withdraw/:id` (auth, own QUEUED only → CANCELLED;
   settled/foreign → 400/403/404). Cancelled keeps shares (never burned).
3. FE `/portfolio`: 3 states (login wall CTA / empty / holding), totals + chart
   Value/PnL toggle, My pools rows (expand Detail + Withdraw → modal), open
   positions masked <0.5, pending + countdown + cancel, history table.
4. Withdraw modal (per design §5): amount + 25/50/Max, shares burned, est SOL,
   instant vs queued note, errors.
5. Asserts + openapi + live verify.

## 2. Non-goals

Partner portal (P4), Advanced (P5), on-chain tx sigs (paper has none — show `—`).
