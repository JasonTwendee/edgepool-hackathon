-- AlterTable
ALTER TABLE "copy_orders" ADD COLUMN     "delay_drag_pct" DECIMAL(8,4),
ADD COLUMN     "entry_mode" VARCHAR(10) NOT NULL DEFAULT 'immediate',
ADD COLUMN     "stop_pct" DECIMAL(8,4),
ADD COLUMN     "tp1_pct" DECIMAL(8,4);
