-- CreateTable
CREATE TABLE "vaults" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "fee_bps" INTEGER NOT NULL DEFAULT 0,
    "hwm_share_price" DECIMAL(24,12) NOT NULL DEFAULT 1,
    "total_shares" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_deposits" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "depositor" VARCHAR(100) NOT NULL,
    "amount_sol" DECIMAL(24,12) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    "shares_minted" DECIMAL(24,12),
    "share_price" DECIMAL(24,12),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ,

    CONSTRAINT "vault_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_withdrawals" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "depositor" VARCHAR(100) NOT NULL,
    "shares_requested" DECIMAL(24,12) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    "share_price" DECIMAL(24,12),
    "payout_sol" DECIMAL(24,12),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ,

    CONSTRAINT "vault_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_epochs" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "nav_sol" DECIMAL(24,12) NOT NULL,
    "share_price" DECIMAL(24,12) NOT NULL,
    "shares_outstanding" DECIMAL(24,12) NOT NULL,
    "fee_sol" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_epochs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_deposits_vault_id_status_idx" ON "vault_deposits"("vault_id", "status");

-- CreateIndex
CREATE INDEX "vault_withdrawals_vault_id_status_idx" ON "vault_withdrawals"("vault_id", "status");

-- CreateIndex
CREATE INDEX "vault_epochs_vault_id_created_at_idx" ON "vault_epochs"("vault_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "vault_deposits" ADD CONSTRAINT "vault_deposits_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_withdrawals" ADD CONSTRAINT "vault_withdrawals_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_epochs" ADD CONSTRAINT "vault_epochs_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
