/**
 * In-process signal event bus (pool terminal log).
 *
 * The copy engine (auto-fire / manage ticks) emits one small event per
 * pipeline step; `GET /api/vaults/:id/signals/stream` replays recent events
 * then forwards live ones over SSE. Static singleton on purpose: no DI
 * wiring, no cross-module imports, tsx-safe. Ring buffer cap 200/vault.
 */

export type SignalKind = 'SKIP' | 'ENTER' | 'EXIT';

export interface SignalEvent {
  vaultId: number;
  kind: SignalKind;
  token: string;
  trader: string;
  note: string;
  at: number;
}

type Listener = (e: SignalEvent) => void;

const CAP = 200;
const buffers = new Map<number, SignalEvent[]>();
const listeners = new Map<number, Set<Listener>>();

export function emitSignal(e: Omit<SignalEvent, 'at'> & { at?: number }): SignalEvent {
  const full: SignalEvent = { at: Date.now(), ...e };
  const buf = buffers.get(full.vaultId) ?? [];
  buf.push(full);
  if (buf.length > CAP) buf.splice(0, buf.length - CAP);
  buffers.set(full.vaultId, buf);
  listeners.get(full.vaultId)?.forEach((cb) => {
    try {
      cb(full);
    } catch {
      // one bad listener must not break the tick
    }
  });
  return full;
}

export function replaySignals(vaultId: number, limit = 50): SignalEvent[] {
  return (buffers.get(vaultId) ?? []).slice(-Math.max(1, limit));
}

export function subscribeSignals(vaultId: number, cb: Listener): () => void {
  let set = listeners.get(vaultId);
  if (!set) {
    set = new Set();
    listeners.set(vaultId, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

/** Test-only: reset bus state between assert runs. */
export function resetSignalBus(): void {
  buffers.clear();
  listeners.clear();
}
