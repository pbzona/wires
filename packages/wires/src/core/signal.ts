/**
 * A discrete digital logic value. `"X"` means unknown or uninitialized.
 *
 * Signals are compared by identity (`=== 0`, `=== 1`, `=== "X"`), never by
 * JavaScript truthiness.
 */
export type Signal = 0 | 1 | "X";

/** The unknown signal value. */
export const X = "X" satisfies Signal;

/** All valid signal values, in display order. */
export const SIGNALS: readonly Signal[] = Object.freeze([0, 1, "X"] as const);

/** True when `value` is one of `0`, `1` or `"X"`. */
export function isSignal(value: unknown): value is Signal {
  // Object.is rejects -0, which `=== 0` would let through and store on a wire.
  return Object.is(value, 0) || value === 1 || value === "X";
}

/** A recorded change of one wire's value at one simulation tick. */
export type SignalTransition = {
  readonly tick: number;
  /** The wire's id: the path of the port that drives it, e.g. `"root.nand.outputs.out"`. */
  readonly wire: string;
  readonly previous: Signal;
  readonly value: Signal;
};

/** Human-readable form of an arbitrary value, for error messages. */
export function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return `${value}n`;
  if (Object.is(value, -0)) return "-0";
  if (value === null || typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
