-- CreateTable
CREATE TABLE "tracked_wallets" (
    "id" SERIAL NOT NULL,
    "address" VARCHAR(64) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "handle" VARCHAR(50) NOT NULL,
    "owner_notes" TEXT,
    "allocation_weight" DECIMAL(4,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_scanned_slot" BIGINT,
    "last_scanned_signature" VARCHAR(100),
    "total_trades_count" INTEGER NOT NULL DEFAULT 0,
    "win_rate" DECIMAL(5,2),
    "cumulative_pnl_usd" DECIMAL(15,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tracked_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "signature" VARCHAR(100) NOT NULL,
    "wallet_address" VARCHAR(64) NOT NULL,
    "slot" BIGINT NOT NULL,
    "block_time" BIGINT NOT NULL,
    "formatted_time" VARCHAR(50) NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "symbol" VARCHAR(30) NOT NULL,
    "token_mint" VARCHAR(64),
    "amount_token" DECIMAL(24,8),
    "amount_usd" DECIMAL(15,2),
    "dex_venue" VARCHAR(50) NOT NULL,
    "slippage_bps" INTEGER NOT NULL,
    "fee_sol" DECIMAL(10,8) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("signature")
);

-- CreateTable
CREATE TABLE "realtime_events" (
    "id" SERIAL NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "wallet_address" VARCHAR(64) NOT NULL,
    "tx_signature" VARCHAR(100),
    "title" VARCHAR(200) NOT NULL,
    "payload" JSONB,
    "broadcasted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracked_wallets_address_key" ON "tracked_wallets"("address");

-- CreateIndex
CREATE INDEX "transactions_wallet_address_slot_idx" ON "transactions"("wallet_address", "slot" DESC);

-- CreateIndex
CREATE INDEX "realtime_events_wallet_address_broadcasted_at_idx" ON "realtime_events"("wallet_address", "broadcasted_at" DESC);

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "tracked_wallets"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime_events" ADD CONSTRAINT "realtime_events_wallet_address_fkey" FOREIGN KEY ("wallet_address") REFERENCES "tracked_wallets"("address") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realtime_events" ADD CONSTRAINT "realtime_events_tx_signature_fkey" FOREIGN KEY ("tx_signature") REFERENCES "transactions"("signature") ON DELETE CASCADE ON UPDATE CASCADE;
