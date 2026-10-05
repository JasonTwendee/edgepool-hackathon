-- AlterTable
ALTER TABLE "copy_orders" ADD COLUMN     "close_reason" VARCHAR(16),
ADD COLUMN     "closed_at" TIMESTAMPTZ,
ADD COLUMN     "entry_price_usd" DECIMAL(24,12),
ADD COLUMN     "exit_price_usd" DECIMAL(24,12),
ADD COLUMN     "peak_price_usd" DECIMAL(24,12),
ADD COLUMN     "realized_pnl_usd" DECIMAL(15,2);
