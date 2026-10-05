# Tracker — Dynamic allocation

- Topic: dynamic-alloc
- Intent: `docs/codexminimal/idsd/2026-10-02-dynamic-alloc-intent.md`
- Started: 2026-10-02
- Approval: user 2026-10-02 (dynamic allocation paper-only)

## Phases

- [x] G1 scoring + rebalance service: `done` (rank-based + neutral/clamp/normalize + audit + loop-off default)
- [x] G2 sizing slice + endpoint + contract: `done` (weight slice fail-open + rebalance endpoint + openapi + env key)
- [x] G3 asserts + live + regression + review: `done` (`assert-alloc.ts` GREEN 6 nhóm; live rebalance sum 10000 + all + 401; 12/12 asserts GREEN; root tsc ✅; reviewer APPROVE)

## Review gate — APPROVE

Rank-based scoring (miễn nhiễm scale PnL tuyệt đối); neutral guard khi <3 orders;
floor 500 / cap 4000 với cap chỉ áp cho n≥3 (đã xử lý trường hợp infeasible cho duo);
loop rebalance OFF mặc định; out-of-scope = legacy full budget; fail-open về legacy
khi thiếu data. Paper-only, không path mainnet.

## Handoff log

- 2026-10-02: intake xong (rank-based, neutral guard, loop-off default).
- 2026-10-02: G1–G3 dong.
