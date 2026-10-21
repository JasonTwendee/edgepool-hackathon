-- Chain events relation was created without a FK in the first chain migration.
-- Add it now so deleting a vault cascades its event mirror (Prisma schema has
-- onDelete: Cascade). Additive-only; safe on an empty/partially filled table.
ALTER TABLE "chain_events"
  ADD CONSTRAINT "chain_events_vault_id_fkey"
  FOREIGN KEY ("vault_id") REFERENCES "vaults"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
