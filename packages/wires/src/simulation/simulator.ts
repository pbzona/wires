import type { ComponentDefinition } from "../core/component.js";
import { compile } from "../core/elaborate.js";
import { SimulationError, StabilizationError } from "../core/errors.js";
import { describeValue, isSignal, type Signal, type SignalTransition } from "../core/signal.js";
import { EventQueue } from "./scheduler.js";

/** Options accepted by {@link simulate}. */
export type SimulationOptions = {
  /** Maximum ticks a single `run()` may execute before failing. Default 10 000. */
  readonly maxTicks?: number;
  /** Record every signal transition for `trace()`. Default `false`. */
  readonly trace?: boolean;
};

/** Result of a successful `run()`. */
export type RunResult = {
  /** Ticks executed by this call. */
  readonly ticks: number;
  /** Simulation time after the call. */
  readonly tick: number;
};

/** Snapshot of the simulation state returned by `inspect()`. */
export type SimulationSnapshot = {
  /** Current simulation time: the next tick to be processed. */
  readonly tick: number;
  /** Current value of every port in the hierarchy, keyed by hierarchical port id. */
  readonly signals: Readonly<Record<string, Signal>>;
  /** Number of scheduled signal changes not yet applied. */
  readonly pendingEvents: number;
  /** True when nothing is scheduled and every gate has had its initial evaluation. */
  readonly stable: boolean;
};

/** A running simulation of one circuit definition. */
export interface Simulator<I extends string = string, O extends string = string> {
  /** Assigns external inputs. Changes are applied at the current tick by the next `tick()`/`run()`. */
  set(inputs: { readonly [K in I]?: Signal }): void;
  /** Current value of an external output. Never advances time. */
  read(output: O): Signal;
  /** Current values of all external outputs. Never advances time. */
  readAll(): { [K in O]: Signal };
  /** Processes the current tick and advances time by one. */
  tick(): void;
  /** Ticks until no changes remain scheduled; throws `StabilizationError` after `maxTicks`. */
  run(): RunResult;
  /** Restores the initial state: all signals `X`, time 0, empty queue and trace. */
  reset(): void;
  /** Snapshot of current internal state. */
  inspect(): SimulationSnapshot;
  /** Recorded transitions, oldest first (empty unless tracing is enabled). */
  trace(): readonly SignalTransition[];
}

const DEFAULT_MAX_TICKS = 10_000;
const RECENT_LIMIT = 16;

/**
 * Creates an independent simulator for a definition. Many simulators can share
 * one definition; none of them share mutable state.
 */
export function simulate<I extends string, O extends string>(
  definition: ComponentDefinition<I, O>,
  options: SimulationOptions = {},
): Simulator<I, O> {
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  if (!Number.isSafeInteger(maxTicks) || maxTicks < 1) {
    throw new SimulationError(`maxTicks must be a positive integer (got ${describeValue(maxTicks)})`);
  }
  const tracing = options.trace ?? false;
  if (typeof tracing !== "boolean") {
    throw new SimulationError(`trace must be a boolean (got ${describeValue(tracing)})`);
  }

  const circuit = compile(definition as ComponentDefinition);
  const { gates, readers, netIds } = circuit;
  const values: Signal[] = netIds.map(() => "X");
  const queue = new EventQueue();
  const dirty = new Uint8Array(gates.length);
  let time = 0;
  let initialPending = true;
  let transitions: SignalTransition[] = [];
  let recent: SignalTransition[] = [];

  const knownNames = (names: Iterable<string>) => [...names].join(", ") || "(none)";

  /** Schedules `value` for `net` at `tick`, skipping changes that would be no-ops. */
  const schedule = (tick: number, net: number, value: Signal): void => {
    if (queue.pending(tick, net) !== undefined || values[net] !== value) queue.schedule(tick, net, value);
  };

  const evaluate = (gi: number): void => {
    const gate = gates[gi]!;
    const inputs: Record<string, Signal> = {};
    gate.inputNames.forEach((name, i) => {
      inputs[name] = values[gate.inputNets[i]!]!;
    });
    const where = `Primitive ${gate.definition} at ${gate.path}`;
    let result: unknown;
    try {
      result = gate.evaluate(Object.freeze(inputs));
    } catch (cause) {
      throw new SimulationError(`${where} threw during evaluation: ${(cause as Error)?.message ?? cause}`, { cause });
    }
    if (typeof result !== "object" || result === null) {
      throw new SimulationError(`${where} must return an object of outputs (got ${describeValue(result)})`);
    }
    const out = result as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      if (!gate.outputNames.includes(key)) {
        throw new SimulationError(
          `${where} returned unexpected output "${key}" (outputs are ${knownNames(gate.outputNames)})`,
        );
      }
    }
    gate.outputNames.forEach((name, i) => {
      if (!Object.hasOwn(out, name)) throw new SimulationError(`${where} did not return output "${name}"`);
      const value = out[name];
      if (!isSignal(value)) {
        throw new SimulationError(
          `${where} returned an invalid signal for output "${name}": ${describeValue(value)} (expected 0, 1 or "X")`,
        );
      }
      schedule(time + 1, gate.outputNets[i]!, value);
    });
  };

  const tick = (): void => {
    const touched: number[] = [];
    const markDirty = (gi: number) => {
      if (dirty[gi] === 0) {
        dirty[gi] = 1;
        touched.push(gi);
      }
    };
    if (initialPending) {
      initialPending = false;
      gates.forEach((_, gi) => markDirty(gi));
    }
    // 1. Apply this tick's changes.
    for (const [net, value] of queue.take(time)) {
      const previous = values[net]!;
      if (previous === value) continue;
      values[net] = value;
      const transition: SignalTransition = Object.freeze({ tick: time, signalId: netIds[net]!, previous, value });
      if (tracing) transitions.push(transition);
      recent.push(transition);
      if (recent.length > RECENT_LIMIT) recent.shift();
      // 2. Gates whose inputs changed need evaluation.
      for (const gi of readers[net]!) markDirty(gi);
    }
    // 3–4. Evaluate against the current snapshot; changed outputs land on the next tick.
    touched.sort((a, b) => a - b);
    try {
      for (const gi of touched) evaluate(gi);
    } finally {
      for (const gi of touched) dirty[gi] = 0;
    }
    // 5. Advance time.
    time++;
  };

  const isStable = () => queue.size === 0 && !initialPending;

  const simulator: Simulator<I, O> = {
    set(inputs) {
      if (typeof inputs !== "object" || inputs === null) {
        throw new SimulationError(`set() expects an object of input values (got ${describeValue(inputs)})`);
      }
      const updates: Array<[number, Signal]> = [];
      for (const [name, value] of Object.entries(inputs as Record<string, unknown>)) {
        const net = circuit.inputNets.get(name);
        if (net === undefined) {
          throw new SimulationError(`Unknown input "${name}" (inputs are ${knownNames(circuit.inputNets.keys())})`);
        }
        if (!isSignal(value)) {
          throw new SimulationError(
            `Invalid signal for input "${name}": ${describeValue(value)} (expected 0, 1 or "X")`,
          );
        }
        updates.push([net, value]);
      }
      for (const [net, value] of updates) schedule(time, net, value);
    },

    read(output) {
      const net = circuit.outputNets.get(output);
      if (net === undefined) {
        throw new SimulationError(
          `Unknown output "${String(output)}" (outputs are ${knownNames(circuit.outputNets.keys())})`,
        );
      }
      return values[net]!;
    },

    readAll() {
      const result: Record<string, Signal> = {};
      for (const [name, net] of circuit.outputNets) result[name] = values[net]!;
      return result as { [K in O]: Signal };
    },

    tick,

    run() {
      let ticks = 0;
      while (!isStable()) {
        if (ticks >= maxTicks) {
          const components = [
            ...new Set(
              recent.map((t) => circuit.drivers[netIds.indexOf(t.signalId)]!).filter((gi) => gi >= 0),
            ),
          ].map((gi) => gates[gi]!.path);
          throw new StabilizationError({
            tick: time,
            ticksExecuted: ticks,
            maxTicks,
            recentChanges: Object.freeze([...recent]),
            components: Object.freeze(components.sort()),
          });
        }
        tick();
        ticks++;
      }
      return { ticks, tick: time };
    },

    reset() {
      values.fill("X");
      queue.clear();
      dirty.fill(0);
      time = 0;
      initialPending = true;
      transitions = [];
      recent = [];
    },

    inspect() {
      const signals: Record<string, Signal> = {};
      circuit.netlist.ports.forEach((port, i) => {
        signals[port] = values[circuit.portNetIndices[i]!]!;
      });
      return { tick: time, signals, pendingEvents: queue.size, stable: isStable() };
    },

    trace() {
      return Object.freeze([...transitions]);
    },
  };
  return Object.freeze(simulator);
}
