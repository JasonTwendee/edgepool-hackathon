-- Fix 20/10 VPS meltdown: dedupe lookups in onchain.service +
-- history-sync query realtime_events by tx_signature with no index —
-- every incoming swap event triggered a full ~5M-row seq scan, saturating
-- Postgres (300-600% CPU, load 15-20 on the 2GB demo box).
CREATE INDEX "realtime_events_tx_signature_idx" ON "realtime_events"("tx_signature");
