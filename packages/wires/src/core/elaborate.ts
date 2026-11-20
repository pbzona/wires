import {
  type ComponentDefinition,
  type Evaluator,
  portPath,
  requireInternals,
} from "./component.js";
import { CircuitError } from "./errors.js";

/** A composite component that contains a primitive gate. */
export type Ancestor = {
  readonly id: string;
  readonly definition: string;
};

/**
 * One wire: a single driver (a root input or a primitive output) plus every
 * port connected to it. Connections add no delay, so all of them always carry
 * the same value.
 */
export type WireInfo = {
  /** Wire id: the hierarchical path of the driving port. */
  readonly id: string;
  /** Whether the wire is driven by an external input or by a primitive gate output. */
  readonly driver: "input" | "gate";
  /** Path of the driving gate, when `driver === "gate"`. */
  readonly gate: string | null;
  /** Every port path that carries this wire's value, in hierarchical order (includes `id`). */
  readonly ports: readonly string[];
  /** Paths of the gates that read this wire. */
  readonly readers: readonly string[];
};

/** One primitive gate in the flattened graph. */
export type GateInfo = {
  /** Hierarchical path, e.g. `"root.not.g"`. */
  readonly path: string;
  /** Name of the primitive definition. */
  readonly definition: string;
  /** Composite components containing this gate, outermost first. */
  readonly ancestors: readonly Ancestor[];
  /** Input port name to wire id. */
  readonly inputs: Readonly<Record<string, string>>;
  /** Output port name to wire id. */
  readonly outputs: Readonly<Record<string, string>>;
};

/** Serializable, flattened view of a circuit: primitive gates and the wires between them. */
export type Netlist = {
  readonly root: string;
  readonly definition: string;
  /** External input name to wire id. */
  readonly inputs: Readonly<Record<string, string>>;
  /** External output name to wire id. */
  readonly outputs: Readonly<Record<string, string>>;
  /** Wires sorted by id. */
  readonly wires: readonly WireInfo[];
  /** Primitive gates sorted by path. */
  readonly gates: readonly GateInfo[];
  /** Every port path in the hierarchy, in hierarchical (declaration) order. */
  readonly ports: readonly string[];
  /** Port path to wire id. */
  readonly portWires: Readonly<Record<string, string>>;
};

/** Index-based form of the netlist used by the simulator. Internal. */
export type CompiledCircuit = {
  readonly netlist: Netlist;
  readonly wireIds: readonly string[];
  readonly gates: readonly CompiledGate[];
  /** Per wire: indices of gates reading it, ascending. */
  readonly readers: readonly (readonly number[])[];
  /** Per wire: index of the driving gate, or -1 for external inputs. */
  readonly drivers: readonly number[];
  readonly inputWires: ReadonlyMap<string, number>;
  readonly outputWires: ReadonlyMap<string, number>;
  /** Wire index for each entry of `netlist.ports`. */
  readonly portWireIndices: readonly number[];
};

export type CompiledGate = {
  readonly path: string;
  readonly definition: string;
  readonly evaluate: Evaluator;
  readonly inputNames: readonly string[];
  readonly inputWires: readonly number[];
  readonly outputNames: readonly string[];
  readonly outputWires: readonly number[];
};

const ROOT = "root";
const cache = new WeakMap<ComponentDefinition, CompiledCircuit>();

/**
 * Flattens a hierarchical definition into a graph of primitive gates and wires.
 * The hierarchy is preserved through gate paths and ancestor lists.
 */
export function elaborate(definition: ComponentDefinition): Netlist {
  return compile(definition).netlist;
}

/** Elaborates and indexes a definition for simulation. Results are cached per definition. */
export function compile(definition: ComponentDefinition): CompiledCircuit {
  const cached = cache.get(definition);
  if (cached !== undefined) return cached;
  const compiled = build(definition);
  cache.set(definition, compiled);
  return compiled;
}

type RawGate = {
  path: string;
  definition: ComponentDefinition;
  evaluate: Evaluator;
  ancestors: readonly Ancestor[];
};

function build(definition: ComponentDefinition): CompiledCircuit {
  requireInternals(definition, "elaborate()");
  const ports: string[] = [];
  const rawGates: RawGate[] = [];
  /** Destination port path to the source port path that drives it. */
  const driverOf = new Map<string, string>();
  const rootInputs = new Set(definition.inputs.map((name) => portPath(ROOT, "input", name)));
  const gateOutputs = new Map<string, string>(); // output port path -> gate path

  const walk = (def: ComponentDefinition, path: string, ancestors: readonly Ancestor[]): void => {
    for (const name of def.inputs) ports.push(portPath(path, "input", name));
    for (const name of def.outputs) ports.push(portPath(path, "output", name));
    const data = requireInternals(def, "elaborate()");
    if (data.kind === "primitive") {
      rawGates.push({ path, definition: def, evaluate: data.evaluate, ancestors });
      for (const name of def.outputs) gateOutputs.set(portPath(path, "output", name), path);
      return;
    }
    const structure = data.structure;
    const inner = Object.freeze([...ancestors, Object.freeze({ id: path, definition: def.name })]);
    for (const child of structure.instances) walk(child.definition, `${path}.${child.name}`, inner);
    for (const { source, destination } of structure.connections) {
      const abs = (ref: typeof source) =>
        portPath(ref.instance === null ? path : `${path}.${ref.instance}`, ref.direction, ref.name);
      driverOf.set(abs(destination), abs(source));
    }
  };
  walk(definition, ROOT, []);

  // Resolve every port to the port that ultimately drives it.
  const wireOfPort = new Map<string, string>();
  const resolve = (port: string): string => {
    const known = wireOfPort.get(port);
    if (known !== undefined) return known;
    const chain: string[] = [];
    const onChain = new Set<string>();
    let current = port;
    let wire: string | undefined;
    for (;;) {
      const resolved = wireOfPort.get(current);
      if (resolved !== undefined) {
        wire = resolved;
        break;
      }
      if (onChain.has(current)) {
        const loop = [...chain.slice(chain.indexOf(current)), current].join(" -> ");
        throw new CircuitError(`Wire loop with no driving gate: ${loop}`, definition.name);
      }
      chain.push(current);
      onChain.add(current);
      const next = driverOf.get(current);
      if (next === undefined) {
        if (!rootInputs.has(current) && !gateOutputs.has(current)) {
          throw new CircuitError(`Port has no driver: ${current}`, definition.name);
        }
        wire = current;
        break;
      }
      current = next;
    }
    for (const p of chain) wireOfPort.set(p, wire);
    return wire;
  };
  for (const port of ports) resolve(port);

  const wireIds = [...new Set(ports.map((p) => wireOfPort.get(p)!))].sort();
  const wireIndex = new Map(wireIds.map((id, i) => [id, i]));
  rawGates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const gates: CompiledGate[] = rawGates.map((g) => {
    const wiresFor = (names: readonly string[], direction: "input" | "output") =>
      names.map((name) => wireIndex.get(wireOfPort.get(portPath(g.path, direction, name))!)!);
    return Object.freeze({
      path: g.path,
      definition: g.definition.name,
      evaluate: g.evaluate,
      inputNames: g.definition.inputs,
      inputWires: Object.freeze(wiresFor(g.definition.inputs, "input")),
      outputNames: g.definition.outputs,
      outputWires: Object.freeze(wiresFor(g.definition.outputs, "output")),
    });
  });

  const readers: number[][] = wireIds.map(() => []);
  const drivers: number[] = wireIds.map(() => -1);
  gates.forEach((g, gi) => {
    for (const n of new Set(g.inputWires)) readers[n]!.push(gi);
    for (const n of g.outputWires) drivers[n] = gi;
  });

  const aliases: string[][] = wireIds.map(() => []);
  const portWireIndices = ports.map((p) => {
    const n = wireIndex.get(wireOfPort.get(p)!)!;
    aliases[n]!.push(p);
    return n;
  });

  const record = (names: readonly string[], wires: readonly number[]) =>
    Object.freeze(Object.fromEntries(names.map((name, i) => [name, wireIds[wires[i]!]!])));
  const inputWires = new Map(definition.inputs.map((name) => [name, wireIndex.get(wireOfPort.get(portPath(ROOT, "input", name))!)!]));
  const outputWires = new Map(definition.outputs.map((name) => [name, wireIndex.get(wireOfPort.get(portPath(ROOT, "output", name))!)!]));

  const netlist: Netlist = deepFreeze({
    root: ROOT,
    definition: definition.name,
    inputs: Object.fromEntries([...inputWires].map(([name, n]) => [name, wireIds[n]!])),
    outputs: Object.fromEntries([...outputWires].map(([name, n]) => [name, wireIds[n]!])),
    wires: wireIds.map((id, n) => ({
      id,
      driver: drivers[n] === -1 ? ("input" as const) : ("gate" as const),
      gate: drivers[n] === -1 ? null : gates[drivers[n]!]!.path,
      ports: aliases[n]!,
      readers: readers[n]!.map((gi) => gates[gi]!.path),
    })),
    gates: gates.map((g, gi) => ({
      path: g.path,
      definition: g.definition,
      ancestors: rawGates[gi]!.ancestors,
      inputs: record(g.inputNames, g.inputWires),
      outputs: record(g.outputNames, g.outputWires),
    })),
    ports,
    portWires: Object.fromEntries(ports.map((p) => [p, wireOfPort.get(p)!])),
  });

  return Object.freeze({
    netlist,
    wireIds: Object.freeze(wireIds),
    gates: Object.freeze(gates),
    readers: Object.freeze(readers.map((r) => Object.freeze(r))),
    drivers: Object.freeze(drivers),
    inputWires,
    outputWires,
    portWireIndices: Object.freeze(portWireIndices),
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
