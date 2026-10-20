-- Public feed GET /api/onchain/events (no wallet filter) and the daily prune
-- order/filter by broadcasted_at alone. The only existing index starts with
-- wallet_address, so both fell back to a ~5M-row seq scan + sort (feed 500
-- after 31s on the 2GB demo box, 20/10). Add the standalone feed/prune index.
CREATE INDEX "realtime_events_broadcasted_at_idx" ON "realtime_events"("broadcasted_at" DESC);
