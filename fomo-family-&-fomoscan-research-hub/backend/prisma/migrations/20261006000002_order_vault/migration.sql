-- AlterTable: copy_orders.vault_id (nullable; legacy rows stay NULL = pool-agnostic).
ALTER TABLE "copy_orders" ADD COLUMN     "vault_id" INTEGER;

-- CreateIndex
CREATE INDEX "copy_orders_vault_id_idx" ON "copy_orders"("vault_id");
