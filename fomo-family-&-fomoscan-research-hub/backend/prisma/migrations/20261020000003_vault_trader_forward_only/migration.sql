-- Forward-only trader tracking: membership timestamps + Fomo selection snapshot.
-- Additive only. Existing active rows start their first term now; inactive rows
-- are marked as legacy exits. No data is deleted.

ALTER TABLE "vault_traders"
  ADD COLUMN "entered_at" TIMESTAMPTZ,
  ADD COLUMN "exited_at" TIMESTAMPTZ,
  ADD COLUMN "entry_snapshot" JSONB,
  ADD COLUMN "exit_reason" VARCHAR(32);

UPDATE "vault_traders"
SET "entered_at" = now()
WHERE "is_active" = true AND "entered_at" IS NULL;

UPDATE "vault_traders"
SET "exited_at" = now(), "exit_reason" = 'legacy'
WHERE "is_active" = false AND "exited_at" IS NULL;

CREATE INDEX "vault_traders_vault_id_entered_at_idx"
  ON "vault_traders" ("vault_id", "entered_at");
