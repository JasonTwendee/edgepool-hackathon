import { getConfig } from './configuration.js';

export const SOLANA_COMMITMENT = 'confirmed' as const;
export const POLL_INTERVAL_MS = 8000;
export const POLL_SAMPLE_SIZE = 2;
export const SSE_HEARTBEAT_MS = 15000;
export const PORTFOLIO_DEFAULT_LIMIT = 25;
/** Full-ledger sync cadence for ALL tracked wallets (override via SYNC_INTERVAL_MS). */
export const SYNC_INTERVAL_MS =
  process.env.SYNC_INTERVAL_MS && Number.isFinite(Number(process.env.SYNC_INTERVAL_MS))
    ? Number(process.env.SYNC_INTERVAL_MS)
    : 20000;

export function getSolanaRpcUrl(): string {
  return getConfig().solanaRpcUrl;
}

/**
 * Read-path RPC: Lantern local cache when configured, else the main RPC.
 * WS subscriptions MUST stay on getSolanaRpcUrl (Lantern breaks WS upgrade).
 */
export function getReadRpcUrl(): string {
  return getConfig().lanternUrl || getConfig().solanaRpcUrl;
}

export function isHeliusEnabled(): boolean {
  return Boolean(getConfig().heliusApiKey);
}

const SENSITIVE_QUERY_KEYS = new Set(['api-key', 'api_key', 'apikey', 'apiKey', 'token', 'key']);

/**
 * Redacts secret query params (api-key, token, …) from RPC URLs before they
 * leave the server. NEVER expose raw provider URLs via API responses/logs —
 * /api/health once leaked a live Helius key this way (fixed 2026-09-29).
 */
export function maskSensitiveUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    // Non-URL values: regex fallback for key=secret patterns.
    return url.replace(
      /([?&#](?:api[-_]?key|token|key)=)[^&#]*/gi,
      '$1***',
    );
  }
}
