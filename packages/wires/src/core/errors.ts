import type { SignalTransition } from "./signal.js";

/** Base class for every error thrown by the library. */
export class WiresError extends Error {
  override name = "WiresError";
}

/**
 * A structural problem with a component definition: bad names, invalid wiring,
 * missing connections, or a netlist that cannot be elaborated.
 */
export class CircuitError extends WiresError {
  override name = "CircuitError";
  /** Path of the offending circuit, component or port, when known. */
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super(path === undefined ? message : `${path}: ${message}`);
    this.path = path;
  }
}

/** A runtime problem: invalid input values, or a misbehaving primitive evaluator. */
export class SimulationError extends WiresError {
  override name = "SimulationError";
}

/** Details attached to a {@link StabilizationError}. */
export type StabilizationDetails = {
  /** Simulation time when the run was stopped. */
  readonly tick: number;
  /** Ticks executed by the `run()` call that failed. */
  readonly ticksExecuted: number;
  /** The configured `maxTicks` limit. */
  readonly maxTicks: number;
  /** The most recent signal transitions, oldest first. */
  readonly recentChanges: readonly SignalTransition[];
  /** Paths of the primitive gates driving the recently changed signals. */
  readonly components: readonly string[];
};

/** Thrown by `run()` when a circuit does not settle within `maxTicks`. */
export class StabilizationError extends SimulationError implements StabilizationDetails {
  override name = "StabilizationError";
  readonly tick: number;
  readonly ticksExecuted: number;
  readonly maxTicks: number;
  readonly recentChanges: readonly SignalTransition[];
  readonly components: readonly string[];

  constructor(details: StabilizationDetails) {
    const changes = details.recentChanges
      .map((t) => `  @${t.tick} ${t.wire}: ${t.previous} -> ${t.value}`)
      .join("\n");
    const components = details.components.length > 0 ? details.components.join(", ") : "(none)";
    super(
      `Circuit did not stabilize after ${details.ticksExecuted} ticks ` +
        `(maxTicks ${details.maxTicks}, current tick ${details.tick}).\n` +
        `Recently changed signals:\n${changes || "  (none)"}\n` +
        `Components involved: ${components}`,
    );
    this.tick = details.tick;
    this.ticksExecuted = details.ticksExecuted;
    this.maxTicks = details.maxTicks;
    this.recentChanges = details.recentChanges;
    this.components = details.components;
  }
}
