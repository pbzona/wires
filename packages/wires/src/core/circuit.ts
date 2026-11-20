import {
  assertName,
  type CircuitScope,
  type CircuitStructure,
  type ComponentDefinition,
  type ComponentInstance,
  type Connection,
  type ConnectionRecord,
  describeAt,
  type Direction,
  type InstanceRecord,
  type Port,
  type PortRecord,
  type PortRole,
  registerDefinition,
  requireInternals,
  type SinkPort,
  type SourcePort,
  validatePortLists,
} from "./component.js";
import { CircuitError } from "./errors.js";
import { describeValue } from "./signal.js";

/** Name and external ports of a composite circuit. */
export type CircuitSpec<I extends readonly string[], O extends readonly string[]> = {
  readonly name: string;
  readonly inputs: I;
  readonly outputs: O;
};

/** The context passed to a circuit's builder callback. */
export type CircuitBuilder<I extends string, O extends string> = {
  /** The circuit's external inputs. Inside the circuit they act as signal sources. */
  readonly inputs: { readonly [K in I]: Port<K, "input", "source"> };
  /** The circuit's external outputs. Inside the circuit they act as signal destinations. */
  readonly outputs: { readonly [K in O]: Port<K, "output", "sink"> };
  /**
   * Instantiates a component (primitive or composite). Without a name, a
   * deterministic one of the form `<Definition>#<n>` is generated.
   */
  add<CI extends string, CO extends string>(
    definition: ComponentDefinition<CI, CO>,
    name?: string,
  ): ComponentInstance<CI, CO>;
  /** Connects a source port to a destination port. One source may drive many destinations. */
  connect(source: SourcePort, destination: SinkPort): Connection;
};

const RESERVED_INSTANCE_NAMES = new Set(["inputs", "outputs"]);

/** Definitions whose builder is currently running, outermost first. */
const buildStack: ComponentDefinition[] = [];

/**
 * Defines a composite circuit built from other components.
 *
 * The builder callback runs once, lazily, the first time the circuit is used
 * (added to another circuit, described, elaborated or simulated). Its result is
 * validated and memoized.
 *
 * ```ts
 * const NOT = circuit({ name: "NOT", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
 *   const g = add(NAND, "g");
 *   connect(inputs.a, g.inputs.a);
 *   connect(inputs.a, g.inputs.b);
 *   connect(g.outputs.out, outputs.out);
 * });
 * ```
 */
export function circuit<const I extends readonly string[], const O extends readonly string[]>(
  spec: CircuitSpec<I, O>,
  build: (builder: CircuitBuilder<I[number], O[number]>) => void,
): ComponentDefinition<I[number], O[number]> {
  if (typeof spec !== "object" || spec === null) {
    throw new CircuitError("circuit() expects a specification object");
  }
  assertName(spec.name, "circuit name");
  const { inputs, outputs } = validatePortLists(spec.name, spec.inputs, spec.outputs);
  if (typeof build !== "function") {
    throw new CircuitError("circuit() expects a builder function", spec.name);
  }

  let structure: CircuitStructure | undefined;
  let building = false;

  const definition: ComponentDefinition<I[number], O[number]> = Object.freeze({
    kind: "composite" as const,
    name: spec.name,
    inputs: inputs as readonly I[number][],
    outputs: outputs as readonly O[number][],
    describe: () => describeAt(definition, "root", "root", null),
  });

  const getStructure = (): CircuitStructure => {
    if (structure !== undefined) return structure;
    if (building) {
      const start = buildStack.indexOf(definition);
      const chain = [...buildStack.slice(start), definition].map((d) => d.name).join(" -> ");
      throw new CircuitError(
        `Recursive component definition cannot be elaborated into a finite circuit: ${chain}`,
        spec.name,
      );
    }
    building = true;
    buildStack.push(definition);
    try {
      structure = runBuilder(definition, build as (builder: CircuitBuilder<string, string>) => void);
      return structure;
    } finally {
      building = false;
      buildStack.pop();
    }
  };

  registerDefinition(definition, { kind: "composite", structure: getStructure });
  return definition;
}

/** Runs a builder callback against a fresh, single-use builder and validates the result. */
function runBuilder(
  definition: ComponentDefinition,
  build: (builder: CircuitBuilder<string, string>) => void,
): CircuitStructure {
  const circuitName = definition.name;
  const scope: CircuitScope = Object.freeze({ kind: "scope", name: circuitName });
  const ownedPorts = new WeakSet<object>();
  const instancesByName = new Map<string, ComponentInstance>();
  const instanceRecords: InstanceRecord[] = [];
  const autoNameCounters = new Map<string, number>();
  const drivers = new Map<SinkPort, Connection>();
  const connections: Connection[] = [];
  let sealed = false;

  const fail = (message: string): never => {
    throw new CircuitError(message, circuitName);
  };

  const makePort = <N extends string, D extends Direction, R extends PortRole>(
    owner: ComponentInstance | CircuitScope,
    name: N,
    direction: D,
    role: R,
  ): Port<N, D, R> => {
    const port: Port<N, D, R> = Object.freeze({
      kind: "port",
      id: `${direction === "input" ? "inputs" : "outputs"}.${name}`,
      name,
      direction,
      role,
      owner,
    });
    ownedPorts.add(port);
    return port;
  };

  const portsOf = <D extends Direction, R extends PortRole>(
    owner: ComponentInstance | CircuitScope,
    names: readonly string[],
    direction: D,
    role: R,
  ) => Object.freeze(Object.fromEntries(names.map((n) => [n, makePort(owner, n, direction, role)])));

  /** Port label relative to the circuit being built, e.g. `inputs.a` or `nand.outputs.out`. */
  const label = (port: Port): string => (port.owner.kind === "scope" ? port.id : `${port.owner.name}.${port.id}`);

  const toRecord = (port: Port): PortRecord => ({
    instance: port.owner.kind === "scope" ? null : port.owner.name,
    direction: port.direction,
    name: port.name,
  });

  const checkPort = (value: unknown, what: "source" | "destination"): Port => {
    if (typeof value !== "object" || value === null || (value as { kind?: unknown }).kind !== "port") {
      return fail(
        `connect() ${what} is not a port (got ${describeValue(value)}); check that the port name exists`,
      );
    }
    const port = value as Port;
    if (!ownedPorts.has(port)) {
      const owner =
        port.owner?.kind === "scope" ? `circuit "${port.owner.name}"` : `instance "${String(port.owner?.name)}"`;
      return fail(
        `connect() ${what} ${port.id} belongs to ${owner}, which is not part of this circuit ` +
          `(connections may only reference this circuit's ports and the components it added)`,
      );
    }
    return port;
  };

  const add = (child: ComponentDefinition, name?: string): ComponentInstance => {
    if (sealed) fail("add() called after the circuit builder finished");
    const childData = requireInternals(child, "add()");
    if (name === undefined) {
      let n = autoNameCounters.get(child.name) ?? 0;
      while (instancesByName.has(`${child.name}#${n}`)) n++;
      autoNameCounters.set(child.name, n + 1);
      name = `${child.name}#${n}`;
    } else {
      assertName(name, "component instance name", circuitName);
      if (RESERVED_INSTANCE_NAMES.has(name)) fail(`"${name}" is a reserved name and cannot name a component instance`);
      if (instancesByName.has(name)) fail(`Duplicate component instance name "${name}"`);
    }
    // Build composite children now: surfaces their errors early and detects recursion.
    if (childData.kind === "composite") childData.structure();

    const handle = { kind: "instance", name, definition: child } as {
      kind: "instance";
      name: string;
      definition: ComponentDefinition;
      inputs: ComponentInstance["inputs"];
      outputs: ComponentInstance["outputs"];
    };
    handle.inputs = portsOf(handle, child.inputs, "input", "sink");
    handle.outputs = portsOf(handle, child.outputs, "output", "source");
    const instance = Object.freeze(handle) as ComponentInstance;
    instancesByName.set(name, instance);
    instanceRecords.push(Object.freeze({ name, definition: child }));
    return instance;
  };

  const connect = (source: SourcePort, destination: SinkPort): Connection => {
    if (sealed) fail("connect() called after the circuit builder finished");
    const src = checkPort(source, "source");
    const dst = checkPort(destination, "destination");
    if (src.role !== "source") {
      fail(
        `${label(src)} cannot be a connection source: ` +
          (src.owner.kind === "scope"
            ? "a circuit's own outputs can only be driven"
            : "a component's inputs can only be driven"),
      );
    }
    if (dst.role !== "sink") {
      fail(
        `${label(dst)} cannot be a connection destination: ` +
          (dst.owner.kind === "scope"
            ? "a circuit's own inputs are driven from outside the circuit"
            : "a component's outputs are driven by the component itself"),
      );
    }
    const existing = drivers.get(dst as SinkPort);
    if (existing !== undefined) {
      fail(
        `${label(dst)} has multiple drivers (${label(existing.source)} and ${label(src)}); ` +
          `each destination may have only one driver`,
      );
    }
    const connection: Connection = Object.freeze({ source: src as SourcePort, destination: dst as SinkPort });
    drivers.set(dst as SinkPort, connection);
    connections.push(connection);
    return connection;
  };

  const selfInputs = portsOf(scope, definition.inputs, "input", "source");
  const selfOutputs = portsOf(scope, definition.outputs, "output", "sink");
  const builder: CircuitBuilder<string, string> = Object.freeze({
    inputs: selfInputs,
    outputs: selfOutputs,
    add: add as CircuitBuilder<string, string>["add"],
    connect,
  });

  const result: unknown = build(builder);
  sealed = true;
  if (typeof (result as { then?: unknown } | undefined)?.then === "function") {
    fail("circuit builder functions must be synchronous");
  }

  const problems: string[] = [];
  for (const instance of instancesByName.values()) {
    for (const port of Object.values(instance.inputs) as Port[]) {
      if (!drivers.has(port as SinkPort)) problems.push(`input ${label(port)} is not connected`);
    }
  }
  for (const port of Object.values(selfOutputs) as Port[]) {
    if (!drivers.has(port as SinkPort)) problems.push(`output ${label(port)} is not driven`);
  }
  if (problems.length > 0) {
    fail(`Invalid circuit:\n  - ${problems.join("\n  - ")}`);
  }

  return Object.freeze({
    instances: Object.freeze(instanceRecords),
    connections: Object.freeze(
      connections.map(
        (c): ConnectionRecord => Object.freeze({ source: toRecord(c.source), destination: toRecord(c.destination) }),
      ),
    ),
  });
}
