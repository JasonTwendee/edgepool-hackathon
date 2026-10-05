# Entity Index

## Backend entities & DTOs (`backend/src/modules/*`)

| Name | Path | Shape | Notes |
|---|---|---|---|
| `TrackedWallet` | `modules/wallets/entities/tracked-wallet.entity.ts` | `address, label, handle, avatar?, totalPnlUsd?, winRate?, isCopyEnabled, allocationWeight, addedAt` | 10 masters seeded, `Map<string, TrackedWallet>` store |
| `CreateWalletDto` | `modules/wallets/dto/create-wallet.dto.ts` | `address*! , label?, handle?, allocationWeight?` | `address` = Base58 Solana PubKey |
| `UpdateWalletDto` | `modules/wallets/dto/update-wallet.dto.ts` | `isCopyEnabled?, allocationWeight?` | PATCH copy-config |
| `OnChainTransactionEvent` | `modules/onchain/entities/onchain-event.entity.ts` | `signature(88ch), slot, blockTime, formattedTime, wallet, walletName?, action, symbol, amountUsd?, dexVenue, slippageBps, status, feeSol, copySignal` | Ledger row; `copySignal.{canCopy, recommendedVenue, estimatedDelayMs, targetSwapAmountUsd}` |
| `PortfolioQueryDto` | `modules/portfolio/dto/portfolio-query.dto.ts` | `wallet?=ALL\|<addr>, limit?=25` | Drives 25/wallet aggregation |
| `ExecuteCopyDto` | `modules/copy-trade/dto/execute-copy.dto.ts` | `masterTxHash?, symbol?, action?, amountUsd?, venue?, masterWallet?, masterHandle?, mode?, confirm?, maxSlippageBps?, paperAmountSol?` | Sim default; paper needs `mode:'paper'`+`confirm:true` |
| `CopyRecord` | `modules/copy-trade/` (service return) | `id, vaultTxHash(88ch), jitoBundleId, slotNumber, ...` | Legacy sim, no chain broadcast |
| `CopyOrder` | `prisma/schema.prisma` → `copy_orders` | `id, masterWallet?, symbol?, action?, amountUsd?, venue?, mode, status PENDING→QUATED→SENT→CONFIRMED|FAILED, devnetSignature?, quoteJson?, error?` | Devnet paper, 1-click gated |
| `Vault/Deposit/Withdrawal/EpochCheckpoint` | `prisma/schema.prisma` → `vaults*` | Vault `feeBps,hwmSharePrice,totalShares`; flows `QUEUED→SETTLED`; epochs `navSol,sharePrice,feeSol` | MoneyFi accounting, off-chain v1 |

## Frontend types (`frontend/types/`)

| Name | Path | Mirrors | Notes |
|---|---|---|---|
| `TraderProfile`, `ApiEndpointDoc`, `ComparisonItem` | `frontend/types/fomo.ts` | legacy `src/types/fomo.ts` | Research dossier shapes |
| `OnChainTransactionEvent`, `TrackedWallet`, `CopyOrder` | `frontend/types/onchain.ts` | BE entities | Must match `openapi.yaml` schemas |

## Enums / unions

- `action`: `BUY | SELL | TRANSFER | UNKNOWN`
- `dexVenue`: `Phoenix CLOB | Titan Meta-DEX | Raydium AMM | Orca Whirlpool | Pump.fun | Solana Native`
- `status`: `SUCCESS | FAILED`
- `symbol`: `$SOL $WIF $POPCAT $MEW $BONK $AERO $JUP $RAY` (portfolio), subset for live events
