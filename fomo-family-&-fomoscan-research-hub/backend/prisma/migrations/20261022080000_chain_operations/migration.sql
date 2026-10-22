CREATE TABLE "chain_operations" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "wallet" VARCHAR(64) NOT NULL,
    "amount_sol" DECIMAL(24,12),
    "shares" DECIMAL(24,12),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "tx_signature" VARCHAR(96),
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMPTZ,
    "indexed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chain_operations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chain_operations_tx_signature_key" ON "chain_operations"("tx_signature");
CREATE UNIQUE INDEX "chain_operations_user_id_idempotency_key_key" ON "chain_operations"("user_id", "idempotency_key");
CREATE INDEX "chain_operations_vault_id_status_idx" ON "chain_operations"("vault_id", "status");
CREATE INDEX "chain_operations_wallet_idx" ON "chain_operations"("wallet");
CREATE INDEX "vault_deposits_vault_id_chain_sig_idx" ON "vault_deposits"("vault_id", "chain_sig");
CREATE INDEX "vault_withdrawals_vault_id_chain_sig_idx" ON "vault_withdrawals"("vault_id", "chain_sig");
