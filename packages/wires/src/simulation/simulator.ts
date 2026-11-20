import type { ComponentDefinition } from "../core/component.js";
import { type CompiledCircuit, type CompiledGate, compile } from "../core/elaborate.js";
import { SimulationError, StabilizationError } from "../core/errors.js";
import { describeValue, isSignal, type Signal, type SignalTransition } from "../core/signal.js";

/** Options accepted by {@link simulate}. They carry over to every later state. */
export type SimulationOptions = {
  /** Maximum ticks a single `run()` may execute before failing. Default 10 000. */
  readonly maxTicks?: number;
  /** Keep every wire change so `trace()` can return it. Default `false`. */
  readonly trace?: boolean;
};

/** Plain, serializable view of a state, returned by `inspect()`. */
export type SimulationSnapshot = {
  /** Simulation time: the next tick to be processed. */
  readonly tick: number;
  /** True when nothing is pending and every gate has had its first evaluation. */
  readonly stable: boolean;
  /** Number of wire changes waiting for the next step. */
  readonly pendingEvents: number;
  /** Current value of every port in the hierarchy, keyed by hierarchical port id. */
  readonly signals: Readonly<Record<string, Signal>>;
  /** Every wire: its current value and all the ports connected to it, keyed by wire id. */
  readonly wires: Readonly<Record<string, { readonly value: Signal; readonly ports: readonly string[] }>>;
};

/**
 * One moment of a simulation. States are immutable: `set()`, `step()` and
 * `run()` return a new state and never change the one you call them on, so
 * you can keep any state around, compare states, or branch from one.
 */
export interface SimulationState<I extends string = string, O extends string = string> {
  /** Simulation time: the next tick to be processed. */
  readonly tick: number;
  /** True when nothing is pending and every gate has had its first evaluation. */
  readonly stable: boolean;
  /** Wire changes applied by the step that produced this state, in wire order. */
  readonly changes: readonly SignalTransition[];
  /** A new state with these external inputs assigned. They take effect on the next step. */
  set(inputs: { readonly [K in I]?: Signal }): SimulationState<I, O>;
  /** A new state, one tick later. */
  step(): SimulationState<I, O>;
  /** A new state, stepped until stable. Throws `StabilizationError` after `maxTicks` steps. */
  run(): SimulationState<I, O>;
  /** Current value of an external output. */
  read(output: O): Signal;
  /** Current values of all external outputs. */
  readAll(): { [K in O]: Signal };
  /** Plain data describing this state, for display or serialization. */
  inspect(): SimulationSnapshot;
  /** Every wire change from tick 0 up to this state, oldest first (empty unless `trace: true`). */
  trace(): readonly SignalTransition[];
}

const DEFAULT_MAX_TICKS = 10_000;
const RECENT_LIMIT = 16;

/** The recorded trace as a linked list, so states can share their history instead of copying it. */
type TraceNode = { readonly transitions: readonly SignalTransition[]; readonly previous: TraceNode | null };

/** Everything a state knows. Never mutated after construction. */
type StateData = {
  readonly circuit: CompiledCircuit;
  readonly maxTicks: number;
  readonly tracing: boolean;
  readonly tick: number;
  /** Current value of every wire, by wire index. */
  readonly values: readonly Signal[];
  /** Wire changes to apply on the next step, by wire index. */
  readonly pending: ReadonlyMap<number, Signal>;
  /** True until the first step, which evaluates every gate once. */
  readonly firstStep: boolean;
  readonly changes: readonly SignalTransition[];
  readonly trace: TraceNode | null;
};

/**
 * Starts a simulation of `definition`. Returns the initial state: tick 0, every
 * signal `"X"`, and every gate due for its first evaluation.
 */
export function simulate<I extends string, O extends string>(
  definition: ComponentDefinition<I, O>,
  options: SimulationOptions = {},
): SimulationState<I, O> {
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  if (!Number.isSafeInteger(maxTicks) || maxTicks < 1) {
    throw new SimulationError(`maxTicks must be a positive integer (got ${describeValue(maxTicks)})`);
  }
  const tracing = options.trace ?? false;
  if (typeof tracing !== "boolean") {
    throw new SimulationError(`trace must be a boolean (got ${describeValue(tracing)})`);
  }
  const circuit = compile(definition as ComponentDefinition);
  return new State({
    circuit,
    maxTicks,
    tracing,
    tick: 0,
    values: Object.freeze(circuit.wireIds.map((): Signal => "X")),
    pending: new Map(),
    firstStep: true,
    changes: Object.freeze([]),
    trace: null,
  }) as SimulationState<string, string> as SimulationState<I, O>;
}

class State implements SimulationState {
  readonly #data: StateData;

  constructor(data: StateData) {
    this.#data = data;
    Object.freeze(this);
  }

  get tick(): number {
    return this.#data.tick;
  }

  get stable(): boolean {
    return this.#data.pending.size === 0 && !this.#data.firstStep;
  }

  get changes(): readonly SignalTransition[] {
    return this.#data.changes;
  }

  set(inputs: Readonly<Record<string, Signal>>): State {
    const d = this.#data;
    if (typeof inputs !== "object" || inputs === null) {
      throw new SimulationError(`set() expects an object of input values (got ${describeValue(inputs)})`);
    }
    // Validate everything first, so a bad entry rejects the whole call.
    const updates: Array<[number, Signal]> = [];
    for (const [name, value] of Object.entries(inputs as Record<string, unknown>)) {
      const wire = d.circuit.inputWires.get(name);
      if (wire === undefined) {
        throw new SimulationError(`Unknown input "${name}" (inputs are ${list(d.circuit.inputWires.keys())})`);
      }
      if (!isSignal(value)) {
        throw new SimulationError(`Invalid signal for input "${name}": ${describeValue(value)} (expected 0, 1 or "X")`);
      }
      updates.push([wire, value]);
    }
    const pending = new Map(d.pending);
    let changed = false;
    for (const [wire, value] of updates) {
      const upcoming = pending.has(wire) ? pending.get(wire) : d.values[wire];
      if (upcoming === value) continue; // already heading to this value
      pending.set(wire, value);
      changed = true;
    }
    if (!changed) return this;
    return new State({ ...d, pending, changes: Object.freeze([]) });
  }

  step(): State {
    const d = this.#data;
    const { gates, readers, wireIds } = d.circuit;
    const toEvaluate = new Set<number>();
    if (d.firstStep) gates.forEach((_, g) => toEvaluate.add(g));

    // 1. Apply the pending changes, in wire order.
    const values = [...d.values];
    const changes: SignalTransition[] = [];
    for (const [wire, value] of [...d.pending].sort((a, b) => a[0] - b[0])) {
      const previous = values[wire]!;
      if (previous === value) continue;
      values[wire] = value;
      changes.push(Object.freeze({ tick: d.tick, wire: wireIds[wire]!, previous, value }));
      // 2. Every gate reading a changed wire needs evaluating.
      for (const g of readers[wire]!) toEvaluate.add(g);
    }

    // 3. Evaluate those gates against this one set of values. Their results
    // don't touch `values`; they become pending changes for the next step.
    const pending = new Map<number, Signal>();
    for (const g of [...toEvaluate].sort((a, b) => a - b)) {
      const gate = gates[g]!;
      const outputs = evaluateGate(gate, values);
      gate.outputWires.forEach((wire, i) => {
        // 4. Only outputs that actually change become events.
        if (outputs[i] !== values[wire]) pending.set(wire, outputs[i]!);
      });
    }

    // 5. Advance time.
    return new State({
      ...d,
      tick: d.tick + 1,
      values: Object.freeze(values),
      pending,
      firstStep: false,
      changes: Object.freeze(changes),
      trace: d.tracing && changes.length > 0 ? { transitions: changes, previous: d.trace } : d.trace,
    });
  }

  run(): State {
    const { maxTicks, circuit } = this.#data;
    let state: State = this;
    let ticks = 0;
    const recent: SignalTransition[] = [];
    while (!state.stable) {
      if (ticks >= maxTicks) {
        const components = new Set<string>();
        for (const t of recent) {
          const driver = circuit.drivers[circuit.wireIds.indexOf(t.wire)]!;
          if (driver >= 0) components.add(circuit.gates[driver]!.path);
        }
        throw new StabilizationError({
          tick: state.tick,
          ticksExecuted: ticks,
          maxTicks,
          recentChanges: Object.freeze(recent),
          components: Object.freeze([...components].sort()),
        });
      }
      state = state.step();
      ticks++;
      recent.push(...state.changes);
      if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT);
    }
    return state;
  }

  read(output: string): Signal {
    const { circuit, values } = this.#data;
    const wire = circuit.outputWires.get(output);
    if (wire === undefined) {
      throw new SimulationError(`Unknown output "${String(output)}" (outputs are ${list(circuit.outputWires.keys())})`);
    }
    return values[wire]!;
  }

  readAll(): Record<string, Signal> {
    const { circuit, values } = this.#data;
    const result: Record<string, Signal> = {};
    for (const [name, wire] of circuit.outputWires) result[name] = values[wire]!;
    return result;
  }

  inspect(): SimulationSnapshot {
    const { circuit, values, pending, tick } = this.#data;
    const signals: Record<string, Signal> = {};
    circuit.netlist.ports.forEach((port, i) => {
      signals[port] = values[circuit.portWireIndices[i]!]!;
    });
    const wires: Record<string, { value: Signal; ports: readonly string[] }> = {};
    circuit.netlist.wires.forEach((wire, i) => {
      wires[wire.id] = { value: values[i]!, ports: wire.ports };
    });
    return { tick, stable: this.stable, pendingEvents: pending.size, signals, wires };
  }

  trace(): readonly SignalTransition[] {
    const batches: (readonly SignalTransition[])[] = [];
    for (let node = this.#data.trace; node !== null; node = node.previous) batches.push(node.transitions);
    return Object.freeze(batches.reverse().flat());
  }
}

/** Runs one primitive's evaluator and checks its result. Returns output values in declaration order. */
function evaluateGate(gate: CompiledGate, values: readonly Signal[]): Signal[] {
  const inputs: Record<string, Signal> = {};
  gate.inputNames.forEach((name, i) => {
    inputs[name] = values[gate.inputWires[i]!]!;
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
      throw new SimulationError(`${where} returned unexpected output "${key}" (outputs are ${list(gate.outputNames)})`);
    }
  }
  return gate.outputNames.map((name) => {
    if (!Object.hasOwn(out, name)) throw new SimulationError(`${where} did not return output "${name}"`);
    const value = out[name];
    if (!isSignal(value)) {
      throw new SimulationError(
        `${where} returned an invalid signal for output "${name}": ${describeValue(value)} (expected 0, 1 or "X")`,
      );
    }
    return value;
  });
}

function list(names: Iterable<string>): string {
  return [...names].join(", ") || "(none)";
}
