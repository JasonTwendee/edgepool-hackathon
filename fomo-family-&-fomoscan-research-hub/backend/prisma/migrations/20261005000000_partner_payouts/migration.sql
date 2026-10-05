-- CreateTable: partner-trader earnings ledger (report §4, 80/15/5 split).
CREATE TABLE "partner_payouts" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "epoch_id" INTEGER,
    "trader" VARCHAR(64) NOT NULL,
    "amount_sol" DECIMAL(24,12) NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'PERF_FEE',
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACCRUED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_payouts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_epoch_id_fkey" FOREIGN KEY ("epoch_id") REFERENCES "vault_epochs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "partner_payouts_vault_id_trader_idx" ON "partner_payouts"("vault_id", "trader");
