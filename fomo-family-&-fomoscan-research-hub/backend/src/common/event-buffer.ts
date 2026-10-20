/**
 * Bounded FIFO buffer for SSE fan-out. Events are flushed on a fixed interval
 * instead of one HTTP write per on-chain event; if a client stalls, the oldest
 * events are dropped so memory cannot grow without bound.
 */
export class EventBuffer<T> {
  private items: T[] = [];

  constructor(private readonly max = 200) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) {
      this.items.splice(0, this.items.length - this.max);
    }
  }

  drain(): T[] {
    if (this.items.length === 0) return [];
    const out = this.items;
    this.items = [];
    return out;
  }

  size(): number {
    return this.items.length;
  }
}
