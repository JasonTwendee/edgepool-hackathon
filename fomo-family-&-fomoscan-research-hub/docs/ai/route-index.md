# Route Index

Canonical contract: `docs/api/openapi.yaml` (75 paths).

## REST — markets / wallets / rotation

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| GET | `/api/health` | `health.controller.ts` → `getHealth` | `api.ts#getHealth` | RPC, `heliusEnabled`, wallet count, secrets masked |
| GET | `/api/market/ticks` | `market.controller.ts` | `useMarketTicker` | CoinGecko majors proxy |
| GET | `/api/market/prices` | `market.controller.ts` | pool/portfolio | DataStream bulk prices proxy |
| GET | `/api/wallets` | `wallets.controller.ts` → `findAll` | `api.ts#listWallets` | Live pool roster (5), not full rotation history |
| PATCH | `/api/wallets/:address` | `wallets.controller.ts` → `updateCopyConfig` | `api.ts#updateWalletCopy` | `isCopyEnabled`, `allocationWeight` |
| POST | `/api/wallets/:address/enrich` | `wallets.controller.ts` | — | bio/EVM enrich |
| GET | `/api/wallets/rotation/status` | `leaderboard.controller.ts` | terminal | 5 active Solana traders |
| POST | `/api/wallets/rotation/tick` | `leaderboard.controller.ts` | — (ADMIN+Audit) | topN=5 cap=20 reconcile |

## REST — portfolio / onchain

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| GET | `/api/portfolio/transactions` | `portfolio.controller.ts` | `api.ts#getPortfolioTransactions` | `?wallet=ALL\|<addr>&limit=` |
| GET | `/api/portfolio/pnl` | `portfolio.controller.ts` | `api.ts#getWalletPnl` | FIFO realized per wallet |
| GET | `/api/portfolio/pnl/overview` | `portfolio.controller.ts` | `api.ts#getPnlOverview` | sidebar realized totals (5 live roster) |
| GET | `/api/portfolio/holdings` | `portfolio.controller.ts` | `api.ts#getHoldings` | live holdings |
| GET | `/api/portfolio/fomoscan` | `portfolio.controller.ts` | leaderboard PnL | FomoScan fast-path display |
| GET | `/api/onchain/events` | `onchain.controller.ts` | `api.ts#listRealtimeEvents` | persisted events |
| POST | `/api/webhooks/helius` | `webhooks.controller.ts` | — | Helius ingest (secret-gated) |

## REST — copy-trade engine

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| POST | `/api/copy-trade/execute` | `copy-trade.controller.ts` → `execute` | `api.ts#executeCopyTrade` + `#executePaperTrade` | Sim default; `mode:paper`+`confirm` → devnet |
| GET | `/api/copy-trade/history` | `copy-trade.controller.ts` → `history` | `api.ts#listCopyHistory` | legs incl. TP1/TP2/trail |
| POST | `/api/copy-trade/auto-fire/tick` | `copy-trade.controller.ts` | `api.ts#runAutoFireTick` (ADMIN+Audit) | Qualify→size 1% NAV→enter |
| POST | `/api/copy-trade/manage/tick` | `copy-trade.controller.ts` | — (ADMIN+Audit) | exits: TP1 60%/TP2/stop/trail/time |
| POST | `/api/copy-trade/allocation/rebalance` | `copy-trade.controller.ts` | — (ADMIN+Audit) | manual (interval default 0) |

## REST — auth / users / audit / demo / bots

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| POST | `/api/auth/nonce` | `auth.controller.ts` | `api.ts#issueAuthNonce` | wallet challenge |
| POST | `/api/auth/verify` | `auth.controller.ts` | `api.ts#verifyAuthSignature` | wallet login → httpOnly cookie |
| POST | `/api/auth/login` | `auth.controller.ts` | `api.ts#loginAccount` | username + scrypt (seeded admin/user/kol) |
| POST | `/api/auth/logout` | `auth.controller.ts` | `api.ts#logout` | session revoke |
| POST | `/api/auth/purge` | `auth.controller.ts` | — (ADMIN+Audit) | revoke sessions |
| GET | `/api/auth/me` | `auth.controller.ts` (AuthGuard) | `api.ts#getAuthMe` | role gating |
| GET | `/api/users` | `users.controller.ts` (ADMIN) | `api.ts#listUsers` | admin panel |
| POST | `/api/users/:wallet/role` | `users.controller.ts` (ADMIN+Audit) | `api.ts#setUserRole` | setRole by username |
| GET | `/api/audit` | `audit.controller.ts` (ADMIN) | `api.ts#listAudit` | append-only |
| GET | `/api/demo/bot/:id/performance` | `demo.controller.ts` | terminal | bot perf |
| POST | `/api/demo/seed` | `demo.controller.ts` (ADMIN+Audit) | — | demo seed |
| POST | `/api/demo/replay` | `demo.controller.ts` (ADMIN+Audit) | — | replay window |
| POST | `/api/demo/reset` | `demo.controller.ts` (ADMIN+Audit) | — | reset demo state |
| POST | `/api/demo/scenario` | `demo.controller.ts` (ADMIN+Audit) | `api.ts#runDemoScenario` + AdminPanel demo tab | reset + 3 cases parallel |
| POST | `/api/demo/partial-close` | `demo.controller.ts` (ADMIN+Audit) | — | partial close tick |
| POST | `/api/demo/clone` | `demo.controller.ts` (ADMIN+Audit) | — | clone tick |
| GET | `/api/bots` | `bots.controller.ts` | `api.ts#listBots` | pool bots |
| POST | `/api/bots` | `bots.controller.ts` (ADMIN+Audit) | `api.ts#createBot` | 1 pool = 1 bot |
| POST | `/api/bots/:id/mode` | `bots.controller.ts` (ADMIN+Audit) | `api.ts#setBotMode` | AUTO/PAUSED |

## REST — vaults / pools

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| GET | `/api/vaults/pools` | `vaults.controller.ts` | `api.ts#listPools` | pool summaries (index) |
| GET | `/api/vaults/:id/pool` | `vaults.controller.ts` | `api.ts#getPoolDetail` | detail + `advanced` (KPIs/risk/ladder/exposure) + `chain` block when chain-bound |
| GET | `/api/vaults/:id/ledger` | `vaults.controller.ts` | — (admin/terminal later) | per-order fund flow + cash statement |
| GET | `/api/vaults/:id/orders` | `vaults.controller.ts` (ADMIN) | — | orders journey for a pool |
| GET | `/api/vaults/mine` | `vaults.controller.ts` (Auth) | `api.ts#getVaultMine` | my position per pool |
| GET | `/api/vaults/portfolio` | `vaults.controller.ts` (Auth) | `api.ts#getPortfolioOverview` | investor overview |
| GET | `/api/vaults/:id/earnings` | `vaults.controller.ts` (KOL-gated) | `api.ts#getVaultEarnings` | partner fee rows |
| POST | `/api/vaults/deposit/challenge` | `signed-intent.controller.ts` (Auth) | `api.ts#depositChallenge` | signed-intent ownership proof |
| POST | `/api/vaults/withdraw/challenge` | `signed-intent.controller.ts` (Auth) | `api.ts#withdrawChallenge` | signed-intent ownership proof |
| POST | `/api/vaults/deposit` | `vaults.controller.ts` (Auth) | `api.ts#queueVaultDeposit` | min 0.5 SOL, slots gate |
| POST | `/api/vaults/withdraw` | `vaults.controller.ts` (Auth) | `api.ts#requestVaultWithdraw` | flat=instant else queued |
| DELETE | `/api/vaults/withdraw/:id` | `vaults.controller.ts` (Auth) | `api.ts#cancelWithdrawal` | cancel QUEUED |
| POST | `/api/vaults/settle` | `vaults.controller.ts` | — | epoch mint/burn + HWM fee |
| GET | `/api/vaults` | `vaults.controller.ts` | `api.ts#listVaults` | admin vault list |
| POST | `/api/vaults` | `vaults.controller.ts` (ADMIN+Audit) | `api.ts#createVault` | create pool |
| GET/POST | `/api/vaults/:id/traders` | `vaults.controller.ts` (+ADMIN write) | `api.ts#assignVaultTrader` | basket assignment |
| DELETE | `/api/vaults/:id/traders/:wallet` | `vaults.controller.ts` (ADMIN+Audit) | `api.ts#removeVaultTrader` | unassign |
| POST | `/api/vaults/:id/policy` | `vaults.controller.ts` (ADMIN+Audit) | `api.ts#setVaultPolicy` | rules/slots/windows |
| GET | `/api/vaults/status` | `vaults.controller.ts` | `api.ts#getVaultStatus` | vault + epoch + queued |

## REST — chain (P2, all OFF unless CHAIN_ENABLED)

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| POST | `/api/chain/faucet` | `faucet.controller.ts` (Auth) | `api.ts#chainFaucet` | public devnet RPC airdrop; 1 grant/24h/user |
| POST | `/api/chain/pools/:id/sync` | `faucet.controller.ts` (Auth) | `api.ts#chainSyncPool` | one indexer poll after on-chain deposit/withdraw |
| POST | `/api/chain/rpc` | `faucet.controller.ts` (Auth) | `lib/chain.ts` fallback fetch | public-first JSON-RPC proxy; Helius key server-side |
| POST | `/api/chain/demo-pool` | `chain-admin.controller.ts` (ADMIN+Audit) | — | create unlisted `demo-chain-*` + initialize devnet vault |
| POST | `/api/chain/pools/:id/initialize` | `chain-admin.controller.ts` (ADMIN+Audit) | — | bind only unlisted `demo-chain-*`; refuses public pools |

## REST — partner (trader portal)

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| POST | `/api/partner/apply` | `partner.controller.ts` | `api.ts#partnerApply` | public, pending review |
| GET | `/api/partner/apply/status` | `partner.controller.ts` | `api.ts#partnerApplyStatus` | public status by wallet |
| GET | `/api/partner/me` | `partner.controller.ts` (Auth) | `api.ts#partnerMe` | pending/claimable/paid fees |
| POST | `/api/partner/payout-wallet/challenge` | `partner.controller.ts` (Auth) | `api.ts#partnerPayoutChallenge` | ownership proof |
| POST | `/api/partner/payout-wallet` | `partner.controller.ts` (Auth) | `api.ts#partnerSetPayoutWallet` | verified set only |
| POST | `/api/partner/claim` | `partner.controller.ts` (Auth) | `api.ts#partnerClaim` | sandbox ledger (no on-chain yet) |
| PATCH | `/api/partner/pools/:id/settings` | `partner.controller.ts` (owner) | `api.ts#partnerUpdateSettings` | rename/pause/slots |
| GET | `/api/partner/pools/:id/traders` | `partner.controller.ts` (owner) | `api.ts#partnerPoolTraders` | manage basket |
| POST | `/api/partner/pools/:id/traders/:wallet/pause` | `partner.controller.ts` (owner) | `api.ts#partnerPauseTrader` | pause trader |
| DELETE | `/api/partner/pools/:id/traders/:wallet` | `partner.controller.ts` (owner) | — | remove trader |
| POST | `/api/partner/pools/:id/request-trader` | `partner.controller.ts` (owner) | `api.ts#partnerRequestTrader` | ask for trader |
| GET | `/api/partner/signals` | `partner.controller.ts` (owner) | `api.ts#partnerSignals` | pool signals |
| GET | `/api/partner/payouts` | `partner.controller.ts` (owner) | `api.ts#partnerPayouts` | payout rows |
| GET | `/api/partner/applications` | `partner.controller.ts` (ADMIN) | — | review queue |
| POST | `/api/partner/applications/:id/review` | `partner.controller.ts` (ADMIN+Audit) | — | approve/reject |

## SSE

| Method | Path | BE handler | FE client | Notes |
|---|---|---|---|---|
| GET | `/api/onchain/stream` | `onchain.controller.ts` → `stream` | `lib/sse.ts`, `hooks/useOnchainStream.ts` | `CONNECTED` then `ONCHAIN_SWAP_EVENT`, 15s `PING` |
| GET | `/api/vaults/:id/signals/stream` | `vaults.controller.ts` → `signalStream` | `components/SignalStream.tsx` | `CONNECTED`, `REPLAY` (30 order events), live `SIGNAL` (SKIP/ENTER/EXIT), heartbeat |

## Frontend routes (Next.js App Router)

| Route | File | Notes |
|---|---|---|
| `/` | `frontend/app/page.tsx` | Pool index (main surface): cards, Day/Week/Month/All PnL |
| `/pools/[id]` | `frontend/app/pools/[id]/page.tsx` | Calm detail; `?view=advanced` = KPIs + risk + ladder + exposure |
| `/portfolio` | `frontend/app/portfolio/page.tsx` | Investor overview + withdraw modal |
| `/trader` | `frontend/app/trader/page.tsx` | KOL portal (fees/claim/settings) |
| `/terminal` | `frontend/app/terminal/page.tsx` | Admin terminal (login wall) |
| layout | `frontend/app/layout.tsx` | Fonts, dark theme, metadata |
