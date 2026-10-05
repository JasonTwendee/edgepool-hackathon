import { useEffect, useRef, useState } from 'react';
import type { OnChainTransactionEvent } from '../types/onchain';
import { subscribeOnchainStream } from '../lib/sse';

/** Live SSE hook — toasts + ledger prepend live in UI layer. */
export function useOnchainStream(onSwap?: (event: OnChainTransactionEvent) => void) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<OnChainTransactionEvent | null>(null);
  // Ref avoids a stale closure: the EventSource subscribes once, but the
  // page's handler changes as selection/tabs change.
  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;

  useEffect(() => {
    const unsubscribe = subscribeOnchainStream((msg) => {
      if (msg.type === 'CONNECTED') setConnected(true);
      if (msg.type === 'ONCHAIN_SWAP_EVENT') {
        setLastEvent(msg.event);
        onSwapRef.current?.(msg.event);
      }
    });
    return unsubscribe;
  }, []);

  return { connected, lastEvent };
}
