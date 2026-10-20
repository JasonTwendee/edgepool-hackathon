# Test Index

## Current state (2026-10-20)

- No `jest`/`vitest` runner. Verification = **28 `assert-*.ts` suites** run with `tsx`
  (mocked Prisma — no network/secrets), plus typecheck + FE build + live smoke.
- CI (`ci.yml`) runs every suite: `for f in $(find src -name 'assert-*.ts' -not -path '*generated*'); do npx tsx "$f" || exit 1; done`
- Run one suite: `cd backend && npx tsx src/modules/vaults/assert-pools.ts` → `… asserts: ALL GREEN`

## Suites by area (`backend/src/`)

| Suite | Covers |
|---|---|
| `common/assert-live-scope.ts` | live scope pool/all/fallback + debouncer coalesce/flush + bounded SSE buffer |
| `common/fomoscan/assert-fomoscan.ts` | FomoScan client, throttle, leaderboard parse |
| `common/market/assert-datastream.ts` | DataStream prices/candles |
| `common/rugcheck/assert-rugcheck.ts` | Qualify rug/mcap gate |
| `modules/audit/assert-audit.ts` | append-only log, `auth.login_failed` |
| `modules/auth/assert-auth.ts` | scrypt login, setRole, purge, session expiry |
| `modules/copy-trade/assert-autofire.ts` | auto-fire qualify→size→enter |
| `modules/copy-trade/assert-alloc.ts` | allocation/rebalance math |
| `modules/copy-trade/assert-manage.ts` | TP ladder + trailing (11 cases) |
| `modules/copy-trade/assert-signals.ts` | signal bus (ring/isolate/unsub) + DB replay mapping |
| `modules/copy-trade/assert-paper-executor.ts` | devnet genesis gate (never mainnet) |
| `modules/demo/assert-demo.ts` | seed/replay/reset |
| `modules/leaderboard/assert-leaderboard.ts` | rotation topN=30 cap=50 reconcile |
| `modules/market/assert-market.ts` | ticks/prices proxy |
| `modules/partner/assert-partner.ts` | trader portal flows |
| `modules/sync/assert-sync.ts` | full-sync + backfill cursors |
| `modules/vaults/assert-vault.ts` | HWM ratchet, shares mint/burn, fee math |
| `modules/vaults/assert-multivault.ts` | multi-pool isolation |
| `modules/vaults/assert-treasury.ts` | treasury + dust routing |
| `modules/vaults/assert-windows.ts` | settle windows open/closed |
| `modules/vaults/assert-pools.ts` | pool detail + advanced ladder payload |
| `modules/vaults/assert-portfolio.ts` | investor overview math |
| `modules/vaults/assert-partner.ts` | 75/25 fee split + payout ledger |
| `modules/wallets/assert-enrich.ts` | bio/EVM enrich |

## Verification commands

```bash
npm run typecheck            # root = BE tsc -p backend + FE tsc -p frontend
npm run build:frontend       # next build must pass
curl -s http://localhost:3000/api/health                       # BE direct
curl -s http://localhost:3001/api/health                       # via FE rewrites (must be green)
# prod pools: thay bằng URL reverse-proxy do chủ hệ thống cấp
```
