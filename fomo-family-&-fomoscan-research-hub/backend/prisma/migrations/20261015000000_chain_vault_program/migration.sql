-- P2 chain module: link off-chain vault rows to the on-chain edgepool-vault
-- program + append-only mirror of program events. All new columns NULL
-- (legacy rows unaffected); no old migration touched.
ALTER TABLE "vaults" ADD COLUMN     "chain_program_id" VARCHAR(64);
ALTER TABLE "vaults" ADD COLUMN     "chain_vault" VARCHAR(64);
ALTER TABLE "vaults" ADD COLUMN     "chain_env" VARCHAR(10);
ALTER TABLE "vaults" ADD COLUMN     "chain_paused" BOOLEAN;

ALTER TABLE "vault_deposits" ADD COLUMN     "chain_sig" VARCHAR(96);
ALTER TABLE "vault_deposits" ADD COLUMN     "chain_slot" BIGINT;

ALTER TABLE "vault_withdrawals" ADD COLUMN     "chain_sig" VARCHAR(96);
ALTER TABLE "vault_withdrawals" ADD COLUMN     "chain_slot" BIGINT;

ALTER TABLE "vault_epochs" ADD COLUMN     "chain_sig" VARCHAR(96);

-- CreateTable: append-only mirror of on-chain program events.
-- Idempotency: @@unique([signature, ix_index, event_index]) — the indexer
-- upserts on this key, so replays never duplicate rows.
CREATE TABLE "chain_events" (
    "id" SERIAL NOT NULL,
    "vault_id" INTEGER NOT NULL,
    "signature" VARCHAR(96) NOT NULL,
    "ix_index" INTEGER NOT NULL,
    "event_index" INTEGER NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "slot" BIGINT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chain_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chain_events_signature_ix_index_event_index_key" ON "chain_events"("signature", "ix_index", "event_index");
CREATE INDEX "chain_events_vault_id_kind_idx" ON "chain_events"("vault_id", "kind");
