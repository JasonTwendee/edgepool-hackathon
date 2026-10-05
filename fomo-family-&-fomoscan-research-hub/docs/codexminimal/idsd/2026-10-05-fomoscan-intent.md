# Intent — FomoScan sponsor integration (P0–P2)

- Date: 2026-10-05
- Stage: intent-bounded → execution (user: sponsor key `fsk_live_…`, full P0–P2)
- Parent: analyst runbook A0 (read-path prod-grade) + PnL compute offload.

## 1. Verified capabilities (live-tested 2026-10-05)

- Base `https://api.fomoscan.sh`, auth `Authorization: Bearer fsk_live_…`
  (plan explore, 60 req/min, ~1M sponsor units). 18 paths (see spec notes).
- `GET /v2/user/handle/{h}` → verified solana + EVM + bio + avatar.
  (`unipcs` matches our tracked wallet byte-for-byte.)
- `GET/POST pnl` (single + batch ≤100) → ready/status + 24h/7d windows
  (netUsd, returnPct, volume, trades, winningTokens).
- `GET /v2/pump/leaderboard/traders` → verified rank + realized/unrealized.
- Thesis feed + WS exist → P3 follow-up (not this topic).

## 2. Intent contract

- **P0**: `common/fomoscan/fomoscan.service.ts` thin client (keyed, throttled
  ≥1.1s/call, TTL cache, FetchLike-injectable, disabled-without-key) +
  `FOMOSCAN_API_KEY/BASE_URL` env + `assert-fomoscan.ts`. Read-only, no behavior change.
- **P1**: `tracked_wallets` += `bio`, `evm_address` (migration + regen);
  `POST /api/wallets/:address/enrich` (ADMIN, manual-only) backfills
  avatar/bio/EVM; `GET /api/portfolio/fomoscan` cross-check (local FIFO vs
  FomoScan, no auto-switch).
- **P2**: `FOMOSCAN_PNL_PRIMARY` (default false): when true + key present,
  `getOverview` serves batch FomoScan mapped to WalletPnl (methodology note
  in code); any failure → local FIFO. FE untouched (same API shape).
- **Non-goals**: thesis/WS ingestion (P3), auto-persist leaderboard (P3),
  per-wallet key rotation, EVM execution.
- **Acceptance**: asserts GREEN (mocked), live enrich 10/10, cross-check runs,
  fast-path behind flag, tsc+build green, review APPROVE.

## 3. Decisions

- D-F1 throttle client-side (don't rely on 429s burning sponsor units).
- D-F2 methodology differs (their net vs our FIFO realized) → flag-gated,
  default local until cross-check reviewed.
- D-F3 key lives ONLY in server `.env` (never committed, never logged).
