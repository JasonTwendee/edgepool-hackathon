-- AlterTable: leaderboard snapshot columns (nullable; backfilled by rotation tick).
ALTER TABLE "tracked_wallets" ADD COLUMN     "fomo_pnl_usd" DECIMAL(15,2),
ADD COLUMN     "fomo_rank" INTEGER,
ADD COLUMN     "fomo_synced_at" TIMESTAMPTZ;
