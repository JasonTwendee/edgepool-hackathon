-- AlterTable
ALTER TABLE "vault_deposits" ADD COLUMN     "user_id" INTEGER;

-- AlterTable
ALTER TABLE "vault_withdrawals" ADD COLUMN     "user_id" INTEGER;

-- AlterTable
ALTER TABLE "vaults" ADD COLUMN     "environment" VARCHAR(10) NOT NULL DEFAULT 'SANDBOX';

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "wallet" VARCHAR(100) NOT NULL,
    "role" VARCHAR(10) NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_nonces" (
    "id" SERIAL NOT NULL,
    "wallet" VARCHAR(100) NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor" VARCHAR(100) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target" VARCHAR(200),
    "reason" TEXT,
    "meta_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_traders" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "wallet" VARCHAR(64) NOT NULL,
    "weight_bps" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_traders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "mode" VARCHAR(10) NOT NULL DEFAULT 'AUTO',
    "vault_id" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'IDLE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_key" ON "users"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "auth_nonces_nonce_key" ON "auth_nonces"("nonce");

-- CreateIndex
CREATE INDEX "auth_nonces_wallet_idx" ON "auth_nonces"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs"("actor");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "vault_traders_vault_id_is_active_idx" ON "vault_traders"("vault_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "vault_traders_vault_id_wallet_key" ON "vault_traders"("vault_id", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "bots_name_key" ON "bots"("name");

-- AddForeignKey
ALTER TABLE "vault_deposits" ADD CONSTRAINT "vault_deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_withdrawals" ADD CONSTRAINT "vault_withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_traders" ADD CONSTRAINT "vault_traders_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;
