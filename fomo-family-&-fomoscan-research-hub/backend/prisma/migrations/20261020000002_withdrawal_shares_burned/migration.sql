-- Exact burned shares per settled withdrawal. Previously inferred as
-- payout/sharePrice, which is exact only while withdraw_fee_bps = 0; any
-- withdrawal fee would under-count burned shares and inflate holder balances
-- (letting a holder drain shares that belong to others).
ALTER TABLE "vault_withdrawals" ADD COLUMN "shares_burned" DECIMAL(24,12);

-- Backfill settled rows. Withdraw fees are 0 on every vault today, so
-- payout/sharePrice is the exact burn for all historical rows.
UPDATE "vault_withdrawals"
SET "shares_burned" = ROUND("payout_sol" / "share_price", 12)
WHERE "status" = 'SETTLED'
  AND "share_price" IS NOT NULL
  AND "share_price" > 0
  AND "payout_sol" IS NOT NULL;
