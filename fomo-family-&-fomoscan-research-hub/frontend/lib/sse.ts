import type { OnChainTransactionEvent } from '../types/onchain';

export type SseMessage =
  | { type: 'CONNECTED'; message: string; timestamp: number }
  | { type: 'ONCHAIN_SWAP_EVENT'; event: OnChainTransactionEvent };

/**
 * Subscribe to GET /api/onchain/stream.
 * Returns an unsubscribe function. Auto-reconnect is left to the hook layer.
 */
export function subscribeOnchainStream(onMessage: (msg: SseMessage) => void): () => void {
  const source = new EventSource('/api/onchain/stream');

  const handler = (e: MessageEvent) => {
    try {
      onMessage(JSON.parse(e.data) as SseMessage);
    } catch {
      // ignore malformed heartbeat/comments
    }
  };

  source.onmessage = handler;
  source.onerror = () => {
    // Let EventSource retry; hook may show degraded state via `readyState`.
  };

  return () => source.close();
}
