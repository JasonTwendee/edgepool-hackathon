-- CreateTable
CREATE TABLE "copy_orders" (
    "id" SERIAL NOT NULL,
    "master_wallet" VARCHAR(64),
    "master_handle" VARCHAR(100),
    "master_tx_hash" VARCHAR(100),
    "symbol" VARCHAR(30),
    "action" VARCHAR(10),
    "amount_usd" DECIMAL(15,2),
    "venue" VARCHAR(50),
    "mode" VARCHAR(10) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "devnet_signature" VARCHAR(100),
    "quote_json" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "copy_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "copy_orders_master_wallet_created_at_idx" ON "copy_orders"("master_wallet", "created_at" DESC);
