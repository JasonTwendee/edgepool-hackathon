-- CreateTable
CREATE TABLE "copy_order_legs" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "leg" VARCHAR(10) NOT NULL,
    "fraction" DECIMAL(8,4) NOT NULL,
    "exit_price_usd" DECIMAL(24,12),
    "realized_pnl_usd" DECIMAL(15,2),
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "copy_order_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "copy_order_legs_order_id_idx" ON "copy_order_legs"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "copy_order_legs_order_id_leg_key" ON "copy_order_legs"("order_id", "leg");

-- AddForeignKey
ALTER TABLE "copy_order_legs" ADD CONSTRAINT "copy_order_legs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "copy_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
