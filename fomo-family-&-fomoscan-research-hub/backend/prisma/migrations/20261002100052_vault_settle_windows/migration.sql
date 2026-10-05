-- AlterTable
ALTER TABLE "vaults" ADD COLUMN     "settle_length_min" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settle_period_hours" INTEGER NOT NULL DEFAULT 0;
