/**
 * Per-key debounce used by the live WS pipeline. A burst of onLogs callbacks
 * for one wallet collapses into a single fetch/enrich/persist attempt.
 */
export class Debouncer {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly delayMs: number,
    private readonly run: (key: string) => void,
  ) {}

  schedule(key: string): void {
    if (this.delayMs <= 0) {
      this.run(key);
      return;
    }
    if (this.timers.has(key)) return; // already coalescing this key
    const timer = setTimeout(() => {
      this.timers.delete(key);
      try {
        this.run(key);
      } catch (err) {
        // A timer callback must never crash the process.
        // eslint-disable-next-line no-console
        console.error('[Debouncer] run failed:', (err as Error).message);
      }
    }, this.delayMs);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  /** Run a pending key immediately (used by tests/shutdown paths). */
  flush(key: string): void {
    const timer = this.timers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(key);
    this.run(key);
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  pendingCount(): number {
    return this.timers.size;
  }

  isPending(key: string): boolean {
    return this.timers.has(key);
  }
}
