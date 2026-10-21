# Entity Index

## Prisma models (`backend/prisma/schema.prisma`, 19 models — NEVER edit applied migrations)

| Model | Table | Key fields | Notes |
|---|---|---|---|
| `TrackedWallet` | `tracked_wallets` | `address` unique, `isActive`, cursor `lastScannedSlot/Signature`, stats `totalTradesCount/winRate/cumulativePnlUsd`, FomoScan `fomoPnlUsd/fomoRank/rank24h/rank7d/rank30d/fomoSyncedAt`, `bio`, `evmAddress`, `avatarUrl` | 30 active universe; dropped → `isActive=false`, history kept |
| `Transaction` | `transactions` | PK `signature`, `walletAddress` FK, `slot/blockTime`, `action`, `symbol/tokenMint`, `amountToken/amountUsd`, `dexVenue/feeSol/status` | Pruned >120d (archived first) |
| `RealtimeEvent` | `realtime_events` | `eventType`, `walletAddress` FK, `txSignature` FK, `payload` | Pruned >120d (archived first) |
| `CopyOrder` | `copy_orders` | `masterWallet/Handle/txHash`, `symbol/action/tokenMint/amountUsd/venue`, `mode`, `status`, `devnetSignature`, `entry/peak/exitPrice`, `tp1Pct/stopPct/trailPct/tp2MultPct`, `closeReason/closedAt/realizedPnlUsd`, `vaultId` | Paper lifecycle; legs in `CopyOrderLeg` |
| `CopyOrderLeg` | `copy_order_legs` | `orderId` FK, `leg` TP1\|TP2\|STOP\|TRAIL\|TIME, `fraction`, `exitPriceUsd/realizedPnlUsd` | unique(`orderId,leg`) |
| `Vault` | `vaults` | `name`, `kind` FLAGSHIP\|PARTNER, `status`, `feeBps`, `hwmSharePrice/totalShares`, `maxSlots/maxTraders`, settle `settlePeriodHours/settleLengthMin`, `lockHours`, `treasurySol`, `ownerUserId`, `rulesJson`, chain `chainProgramId/chainVault/chainEnv/chainPaused` | 1 pool = 1 vault + 1 bot + 3–5 traders; chain columns only for devnet-bound demo |
| `Deposit` | `deposits` | `vaultId`, `depositor`, `userId`, `amountSol`, `status` QUEUED→SETTLED, `sharesMinted/sharePrice`, chain `chainSig/chainSlot` | min 0.5 SOL |
| `Withdrawal` | `withdrawals` | `vaultId`, `depositor`, `userId`, `sharesRequested`, `status`, `payoutSol`, chain `chainSig/chainSlot` | QUEUED cancellable; flat pool = instant |
| `EpochCheckpoint` | `epoch_checkpoints` | `vaultId`, `navSol/sharePrice/sharesOutstanding/feeSol`, chain `chainSig` | NAV series source |
| `ChainEvent` | `chain_events` | `vaultId` FK cascade, `signature/ixIndex/eventIndex` unique, `kind`, `slot`, `payload` | append-only on-chain event mirror; idempotent upsert |
| `VaultTrader` | `vault_traders` | `vaultId`, `wallet`, `weightBps`, `isActive`, `enteredAt`, `exitedAt`, `entrySnapshot`, `exitReason` | basket assignment + forward-only term/why-top |
| `Bot` | `bots` | `name` unique, `mode` AUTO\|PAUSED, `vaultId`, `status` | per-pool engine |
| `User` | `users` | `wallet`/`username` unique, `passwordHash` scrypt, `role` USER\|KOL\|ADMIN, `payoutWallet` + `payoutWalletVerifiedAt` | seeded admin/user/kol |
| `Session` | `sessions` | `tokenHash` sha256 unique, `userId`, `expiresAt` | httpOnly cookie |
| `AuthNonce` | `auth_nonces` | `wallet`, `nonce` unique, `expiresAt/consumedAt` | wallet-login challenge |
| `PayoutWalletChallenge` | `payout_wallet_challenges` | `userId`, `wallet`, `nonce` unique, `expiresAt/consumedAt` | ownership proof before set |
| `PartnerPayout` | `partner_payouts` | `vaultId`, `epochId`, `trader`, `amountSol`, `kind` PERF_FEE, `status` ACCRUED… | fee ledger; 75/25 split (partner pools) |
| `PartnerApplication` | `partner_applications` | `fomoHandle/xHandle/wallet/contact`, `status` | pending team review |
| `TraderRequest` | `trader_requests` | `vaultId`, `fomoHandle/xHandle`, `status` | per-pool trader ask |
| `AuditLog` | `audit_logs` | `actor/action/target/reason/metaJson` | append-only, never pruned |

## Backend DTOs

`wallets/update-wallet`, `portfolio/portfolio-query`, `copy-trade/execute-copy|auto-fire-tick|manage-tick|rebalance`, `vaults/vault` (policy/windows), `partner/partner` (apply/claim/settings), `auth/auth` (nonce/login), `users/users` (setRole), `bots/bots`, `demo/demo`. Explicit `validateDto()` in controllers (tsx-safe).

## Frontend types (`frontend/types/`)

| Name | Path | Mirrors | Notes |
|---|---|---|---|
| pool/investor shapes (`PoolSummary`, `PoolDetail`, `VaultMine`, `PortfolioOverview`, `PartnerMe`, …) | `frontend/types/fund.ts` | vaults/partner DTOs + `openapi.yaml` | Pool app contracts |
| `OnChainTransactionEvent`, `TrackedWallet`, `CopyOrder` | `frontend/types/onchain.ts` | BE entities | Must match `openapi.yaml` schemas |

## Enums / unions

- copy `action`: `BUY | SELL | TRANSFER | UNKNOWN`
- `dexVenue`: `Phoenix CLOB | Titan Meta-DEX | Raydium AMM | Orca Whirlpool | Pump.fun | Solana Native`
- copy order `status`: `PENDING → QUATED → SENT → CONFIRMED | FAILED`
- legs: `TP1 | TP2 | STOP | TRAIL | TIME`
- vault `kind`: `FLAGSHIP | PARTNER`; pool `status`: `live | paused`
- user `role`: `USER | KOL | ADMIN`; payout `kind`: `PERF_FEE`
- fee split: 20% HWM fee → 80 depositors / 15 partner / 5 Edgepool (basket 10/10)
