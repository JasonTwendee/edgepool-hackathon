-- AlterTable: pool app fields (kind/status/listing/slots; defaults keep legacy rows live+public).
ALTER TABLE "vaults" ADD COLUMN     "kind" VARCHAR(16) NOT NULL DEFAULT 'basket',
ADD COLUMN     "status" VARCHAR(16) NOT NULL DEFAULT 'live',
ADD COLUMN     "listing" VARCHAR(16) NOT NULL DEFAULT 'public',
ADD COLUMN     "max_slots" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "max_traders" INTEGER NOT NULL DEFAULT 5;
