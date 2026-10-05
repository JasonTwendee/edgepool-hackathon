# Data Flow — On-chain tracking → API → UI

## 1. Poll loop (`backend/src/server/solana.service.ts`)

```
startListening() — 8s interval
  └─ pollWalletsForNewEvents()
       ├─ filter isCopyEnabled
       ├─ sample 2 wallets/cycle (tránh rate-limit)
       ├─ getSignaturesForAddress(pubkey, { limit: 3, until: lastSig })
       ├─ lastSignatures.set(addr, sigs[0])
       └─ createEventFromSignature() → emitEvent() → SSE subscribers
```

`createEventFromSignature`: `blockTime`, `BUY/SELL` (parity), `symbol` (char-code pick), `venue` (SOL/WIF → Phoenix, còn lại → Titan), `amountUsd = 10000 × allocationWeight`, `copySignal`.

## 2. Portfolio ledger (`GET /api/portfolio/transactions`)

```
portfolio.controller (PortfolioQueryDto: wallet?, limit?=25)
  └─ portfolio.service → solana.service.getPortfolioTransactions(wallet, limit)
       ├─ ALL: duyệt 10 ví × 25 tx = 250
       ├─ single: 25 tx của ví đó
       ├─ mỗi ví: getSignaturesForAddress(limit) → map OnChainTransactionEvent
       ├─ thiếu → bù deterministic fallback đủ limit (generateRealisticSignature 88ch)
       └─ sort slot desc → blockTime desc
```

Response: `{ success, total, walletsCount, perWalletLimit, asOf, data[] }`.

## 3. SSE stream (`GET /api/onchain/stream`)

```
client EventSource → onchain.controller.stream()
  ├─ headers text/event-stream + flush
  ├─ write CONNECTED
  ├─ solana.service.subscribeEvents(cb → write ONCHAIN_SWAP_EVENT)
  ├─ 15s : heartbeat
  └─ close → unsubscribe + clearInterval
```

FE: `lib/sse.ts` + `hooks/useOnchainStream.ts` → toast + prepend ledger.

## 4. Wallets CRUD

```
POST /api/wallets (CreateWalletDto) → PublicKey validate → Map.set → listen ngay
PATCH /api/wallets/:address (UpdateWalletDto) → isCopyEnabled/allocationWeight
DELETE /api/wallets/:address → Map.delete
GET /api/wallets → list
```

## 5. Copy-trade (sim-only)

```
POST /api/copy-trade/execute (ExecuteCopyDto)
  └─ copy-trade.service: random vaultTxHash 88ch + jitoBundleId + slot → CONFIRMED
  Không broadcast, không move fund. Mở rộng thật cần Execution Keypair + Jito bundle + Vault PDA (xem SYSTEM_DOCUMENTATION §6).
```
