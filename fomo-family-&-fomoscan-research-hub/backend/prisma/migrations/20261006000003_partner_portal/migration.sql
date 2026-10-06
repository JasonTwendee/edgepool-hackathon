-- AlterTable: pool partner fields.
ALTER TABLE "vaults" ADD COLUMN     "owner_user_id" INTEGER,
ADD COLUMN     "rules_json" JSONB;

-- AlterTable: partner payout wallet.
ALTER TABLE "users" ADD COLUMN     "payout_wallet" VARCHAR(64);

-- CreateTable: partner applications.
CREATE TABLE "partner_applications" (
    "id" SERIAL NOT NULL,
    "fomo_handle" VARCHAR(100) NOT NULL,
    "x_handle" VARCHAR(100),
    "wallet" VARCHAR(64) NOT NULL,
    "contact" VARCHAR(200) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_applications_status_idx" ON "partner_applications"("status");

-- CreateTable: trader requests.
CREATE TABLE "trader_requests" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "fomo_handle" VARCHAR(100) NOT NULL,
    "x_handle" VARCHAR(100),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trader_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trader_requests_vault_id_status_idx" ON "trader_requests"("vault_id", "status");

-- AddForeignKey
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trader_requests" ADD CONSTRAINT "trader_requests_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
