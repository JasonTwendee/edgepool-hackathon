-- AlterTable: per-window leaderboard ranks for the pool basket display.
ALTER TABLE "tracked_wallets" ADD COLUMN     "rank_24h" INTEGER;
ALTER TABLE "tracked_wallets" ADD COLUMN     "rank_7d" INTEGER;
ALTER TABLE "tracked_wallets" ADD COLUMN     "rank_30d" INTEGER;
