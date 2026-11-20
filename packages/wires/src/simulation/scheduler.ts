import type { Signal } from "../core/signal.js";

/**
 * A tick-keyed queue of pending signal changes. At most one pending value is
 * kept per net and tick; scheduling again overwrites it.
 */
export class EventQueue {
  readonly #events = new Map<number, Map<number, Signal>>();
  #size = 0;

  /** Number of pending (tick, net) changes. */
  get size(): number {
    return this.#size;
  }

  /** The value scheduled for `net` at `tick`, if any. */
  pending(tick: number, net: number): Signal | undefined {
    return this.#events.get(tick)?.get(net);
  }

  schedule(tick: number, net: number, value: Signal): void {
    let bucket = this.#events.get(tick);
    if (bucket === undefined) {
      bucket = new Map();
      this.#events.set(tick, bucket);
    }
    if (!bucket.has(net)) this.#size++;
    bucket.set(net, value);
  }

  /** Removes and returns the changes scheduled for `tick`, sorted by net index. */
  take(tick: number): Array<[net: number, value: Signal]> {
    const bucket = this.#events.get(tick);
    if (bucket === undefined) return [];
    this.#events.delete(tick);
    this.#size -= bucket.size;
    return [...bucket].sort((a, b) => a[0] - b[0]);
  }

  clear(): void {
    this.#events.clear();
    this.#size = 0;
  }
}
