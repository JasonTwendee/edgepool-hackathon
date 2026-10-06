-- AlterTable: payout wallet ownership proof (fix 7).
ALTER TABLE "users" ADD COLUMN     "payout_wallet_verified_at" TIMESTAMPTZ;

-- CreateTable: purpose-bound payout wallet challenges.
CREATE TABLE "payout_wallet_challenges" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "wallet" VARCHAR(64) NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_wallet_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_wallet_challenges_nonce_key" ON "payout_wallet_challenges"("nonce");
CREATE INDEX "payout_wallet_challenges_user_id_idx" ON "payout_wallet_challenges"("user_id");

-- AddForeignKey
ALTER TABLE "payout_wallet_challenges" ADD CONSTRAINT "payout_wallet_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
