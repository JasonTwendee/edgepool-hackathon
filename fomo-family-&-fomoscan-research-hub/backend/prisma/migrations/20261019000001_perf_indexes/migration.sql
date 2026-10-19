-- Perf indexes for sync/heal/ledger scans on 5M+ rows (đo 19/10: heal
-- ORDER BY signature + global action/blockTime scans seq-scan toàn bảng).
-- Server prod đã tạo trước bằng CONCURRENTLY (online, không lock);
-- IF NOT EXISTS để migrate là no-op ở đó, áp dụng sạch cho DB mới.
CREATE INDEX IF NOT EXISTS "Transaction_action_blockTime_idx" ON "transactions" ("action", "block_time" DESC);
CREATE INDEX IF NOT EXISTS "Transaction_walletAddress_amountUsd_tokenMint_idx" ON "transactions" ("wallet_address", "amount_usd", "token_mint");
CREATE INDEX IF NOT EXISTS "Transaction_blockTime_idx" ON "transactions" ("block_time" DESC);
