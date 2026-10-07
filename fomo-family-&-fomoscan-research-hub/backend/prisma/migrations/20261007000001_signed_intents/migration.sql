-- CreateTable: wallet-signed deposit/withdraw intents (message signed, funds stay off-chain).
CREATE TABLE "signed_intents" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "wallet" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "amount_sol" DECIMAL(24,12),
    "shares" DECIMAL(24,12),
    "nonce" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signed_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signed_intents_nonce_key" ON "signed_intents"("nonce");
CREATE INDEX "signed_intents_user_id_idx" ON "signed_intents"("user_id");
CREATE INDEX "signed_intents_wallet_idx" ON "signed_intents"("wallet");

-- ForeignKey
ALTER TABLE "signed_intents" ADD CONSTRAINT "signed_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
