-- AlterTable: FomoScan enrichment columns (nullable; legacy rows stay NULL).
ALTER TABLE "tracked_wallets" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "evm_address" VARCHAR(64);
