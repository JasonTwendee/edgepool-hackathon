ALTER TABLE "chain_operations" ADD COLUMN "onchain_operation_id" BIGINT;
UPDATE "chain_operations" SET "onchain_operation_id" = "id";
ALTER TABLE "chain_operations" ALTER COLUMN "onchain_operation_id" SET NOT NULL;
CREATE UNIQUE INDEX "chain_operations_onchain_operation_id_key" ON "chain_operations"("onchain_operation_id");
