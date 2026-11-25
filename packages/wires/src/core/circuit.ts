import {
  assertName,
  type CircuitScope,
  type CircuitStructure,
  type ComponentDefinition,
  type ComponentInstance,
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

/** What feeds each input of a component being added. Inputs left out must be fed later with `feed()`. */
export type InputWiring<I extends string> = { readonly [K in I]?: SourcePort };

/**
 * The context passed to a circuit's builder callback.
 *
 * Every wiring call reads "destination ← source", like an assignment:
 * `add(NOT, "not", { a: nand.outputs.out })`, `feed(top.inputs.b, bottom.outputs.out)`,
 * `output("out", not.outputs.out)`.
 */
export type CircuitBuilder<I extends string, O extends string> = {
  /** The circuit's own inputs. Use them as sources for the parts you add. */
  readonly inputs: { readonly [K in I]: Port<K, "input", "source"> };
  /**
   * Adds a component (primitive or composite) and wires its inputs. Without a
   * name, a deterministic one of the form `<Definition>#<n>` is generated.
   */
  add<CI extends string, CO extends string>(
    definition: ComponentDefinition<CI, CO>,
    inputs?: InputWiring<CI>,
  ): ComponentInstance<CI, CO>;
  add<CI extends string, CO extends string>(
    definition: ComponentDefinition<CI, CO>,
    name: string,
    inputs?: InputWiring<CI>,
  ): ComponentInstance<CI, CO>;
  /**
   * Feeds a component input that wasn't wired when the component was added.
   * This is how feedback loops are built: the source can come from a component
   * added later.
   */
  feed(input: SinkPort, source: SourcePort): void;
  /** Drives one of the circuit's own outputs from a source. */
  output(name: O, source: SourcePort): void;
};

const RESERVED_INSTANCE_NAMES = new Set(["inputs", "outputs"]);

/**
 * Defines a composite circuit built from other components.
 *
 * The builder callback runs immediately, exactly once, and the result is
 * validated before `circuit()` returns, so mistakes are reported where the
 * circuit is defined. A circuit can only contain definitions that already
 * exist, which also means a circuit can never contain itself.
 *
 * ```ts
 * const AND = circuit({ name: "AND", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
 *   const nand = add(NAND, "nand", { a: inputs.a, b: inputs.b });
 *   const not = add(NOT, "not", { a: nand.outputs.out });
 *   output("out", not.outputs.out);
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

  const definition: ComponentDefinition<I[number], O[number]> = Object.freeze({
    kind: "composite" as const,
    name: spec.name,
    inputs: inputs as readonly I[number][],
    outputs: outputs as readonly O[number][],
    describe: () => describeAt(definition, "root", "root", null),
  });

  const structure = runBuilder(definition, build as (builder: CircuitBuilder<string, string>) => void);
  registerDefinition(definition, { kind: "composite", structure });
  return definition;
}

type Connection = { readonly source: Port; readonly destination: Port };

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
  const drivers = new Map<Port, Connection>();
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

  /** Checks that `value` is a port created by this builder. `where` describes the argument for messages. */
  const checkPort = (value: unknown, where: string): Port => {
    if (typeof value !== "object" || value === null || (value as { kind?: unknown }).kind !== "port") {
      return fail(`${where} is not a port (got ${describeValue(value)}); check that the port name exists`);
    }
    const port = value as Port;
    if (!ownedPorts.has(port)) {
      const owner =
        port.owner?.kind === "scope" ? `circuit "${port.owner.name}"` : `instance "${String(port.owner?.name)}"`;
      return fail(
        `${where} (${port.id}) belongs to ${owner}, which is not part of this circuit ` +
          `(use this circuit's inputs and the outputs of components it added)`,
      );
    }
    return port;
  };

  const checkSource = (value: unknown, where: string): Port => {
    const port = checkPort(value, where);
    if (port.role !== "source") {
      fail(
        `${label(port)} can't be used as a source for ${where}: it's a component input, which receives ` +
          `a signal rather than producing one (sources are this circuit's inputs and its components' outputs)`,
      );
    }
    return port;
  };

  /** Records the connection `destination ← source`, enforcing one driver per destination. */
  const connect = (destination: Port, source: Port): void => {
    const existing = drivers.get(destination);
    if (existing !== undefined) {
      fail(
        `${label(destination)} has multiple drivers (${label(existing.source)} and ${label(source)}); ` +
          `each input or output may have only one driver`,
      );
    }
    const connection = Object.freeze({ source, destination });
    drivers.set(destination, connection);
    connections.push(connection);
  };

  const add = (child: ComponentDefinition, nameOrInputs?: unknown, maybeInputs?: unknown): ComponentInstance => {
    if (sealed) fail("add() called after the circuit builder finished");
    if (child === undefined) {
      fail("add() received undefined; a circuit can only contain components defined before it");
    }
    requireInternals(child, "add()");

    let name: string;
    let inputs: unknown;
    if (typeof nameOrInputs === "string") {
      name = nameOrInputs;
      inputs = maybeInputs;
      assertName(name, "component instance name", circuitName);
      if (RESERVED_INSTANCE_NAMES.has(name)) fail(`"${name}" is a reserved name and cannot name a component instance`);
    } else {
      if (maybeInputs !== undefined) fail(`add(${child.name}, ...): the instance name must be a string`);
      inputs = nameOrInputs;
      let n = autoNameCounters.get(child.name) ?? 0;
      while (instancesByName.has(`${child.name}#${n}`)) n++;
      autoNameCounters.set(child.name, n + 1);
      name = `${child.name}#${n}`;
    }

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

    const sources: Array<[string, Port]> = [];
    if (inputs !== undefined) {
      if (typeof inputs !== "object" || inputs === null) {
        fail(`add(${child.name}, "${name}", ...) expects its inputs as an object like { a: inputs.a }`);
      }
      const given = inputs as Record<string, unknown>;
      for (const key of Object.keys(given)) {
        if (!child.inputs.includes(key)) {
          fail(`${child.name} has no input "${key}" (its inputs are ${child.inputs.join(", ") || "none"})`);
        }
      }
      for (const key of child.inputs) {
        if (Object.hasOwn(given, key)) sources.push([key, checkSource(given[key], `${name}.inputs.${key}`)]);
      }
    }
    // A wiring getter can itself add parts. Check the name after reading all the sources.
    if (instancesByName.has(name)) fail(`Duplicate component instance name "${name}"`);
    instancesByName.set(name, instance);
    instanceRecords.push(Object.freeze({ name, definition: child }));
    for (const [key, source] of sources) connect(instance.inputs[key]!, source);
    return instance;
  };

  const feed = (input: SinkPort, source: SourcePort): void => {
    if (sealed) fail("feed() called after the circuit builder finished");
    const destination = checkPort(input, "feed() input");
    if (destination.role !== "sink") {
      fail(
        `feed() can only feed a component input, not ${label(destination)}` +
          (destination.owner.kind === "scope" ? "" : " (use output() for this circuit's outputs)"),
      );
    }
    connect(destination, checkSource(source, label(destination)));
  };

  const ownOutputs = portsOf(scope, definition.outputs, "output", "sink") as Record<string, Port>;
  const output = (name: string, source: SourcePort): void => {
    if (sealed) fail("output() called after the circuit builder finished");
    if (typeof name !== "string" || !Object.hasOwn(ownOutputs, name)) {
      fail(`"${String(name)}" is not an output of ${circuitName} (its outputs are ${definition.outputs.join(", ") || "none"})`);
    }
    connect(ownOutputs[name]!, checkSource(source, `outputs.${name}`));
  };

  const builder: CircuitBuilder<string, string> = Object.freeze({
    inputs: portsOf(scope, definition.inputs, "input", "source"),
    add: add as CircuitBuilder<string, string>["add"],
    feed,
    output,
  });

  let result: unknown;
  try {
    result = build(builder);
  } finally {
    sealed = true;
  }
  if (typeof (result as { then?: unknown } | undefined)?.then === "function") {
    // The caller gets a synchronous CircuitError, not the builder's promise.
    void Promise.resolve(result).catch(() => {});
    fail("circuit builder functions must be synchronous");
  }

  const problems: string[] = [];
  for (const instance of instancesByName.values()) {
    for (const port of Object.values(instance.inputs) as Port[]) {
      if (!drivers.has(port)) problems.push(`input ${label(port)} is not connected`);
    }
  }
  for (const port of Object.values(ownOutputs)) {
    if (!drivers.has(port)) problems.push(`output ${label(port)} is not driven`);
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
