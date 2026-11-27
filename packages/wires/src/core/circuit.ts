import {
  assertName,
  type CircuitScope,
  type CircuitStructure,
  type ComponentDefinition,
  type ComponentDescription,
  type ComponentInstance,
  type ConnectionRecord,
  describeAt,
  type Direction,
  type InstanceRecord,
  type Port,
  type PortHandles,
  type PortRecord,
  type PortRole,
  registerDefinition,
  requireInternals,
  type SinkPort,
  type SourcePort,
} from "./component.js";
import { validatePortLists, type PortDeclaration, type PinName, type GroupName, type GroupMembers } from "./port-lists.js";
import { CircuitError } from "./errors.js";
import { describeValue } from "./signal.js";

/** Name and external ports of a composite circuit. */
export type CircuitSpec<I extends readonly PortDeclaration[], O extends readonly PortDeclaration[]> = {
  readonly name: string;
  readonly inputs: I;
  readonly outputs: O;
};

/** What feeds each input of a component being added. Inputs left out must be fed later with `feed()`. */
export type InputWiring<I extends string, IG extends string = never> =
  { readonly [K in I]?: SourcePort } & { readonly [K in IG]?: readonly SourcePort[] };

/**
 * The context passed to a circuit's builder callback.
 *
 * Every wiring call reads "destination ← source", like an assignment:
 * `add(NOT, "not", { a: nand.outputs.out })`, `feed(top.inputs.b, bottom.outputs.out)`,
 * `output("out", not.outputs.out)`.
 */
export type CircuitBuilder<I extends string, O extends string, IG extends string = never, OG extends string = never> = {
  /** The circuit's own inputs. Use them as sources for the parts you add. */
  readonly inputs: PortHandles<I, IG, "input", "source">;
  /**
   * Adds a component (primitive or composite) and wires its inputs. Without a
   * name, a deterministic one of the form `<Definition>#<n>` is generated.
   */
  add<CI extends string, CO extends string, CIG extends string = never, COG extends string = never>(
    definition: ComponentDefinition<CI, CO, CIG, COG>,
    inputs?: NoInfer<InputWiring<CI, CIG>>,
  ): ComponentInstance<CI, CO, CIG, COG>;
  add<CI extends string, CO extends string, CIG extends string = never, COG extends string = never>(
    definition: ComponentDefinition<CI, CO, CIG, COG>,
    name: string,
    inputs?: NoInfer<InputWiring<CI, CIG>>,
  ): ComponentInstance<CI, CO, CIG, COG>;
  /**
   * Feeds a component input that wasn't wired when the component was added.
   * This is how feedback loops are built: the source can come from a component
   * added later.
   */
  feed(input: SinkPort, source: SourcePort): void;
  /** Drives a whole group in index order, or one scalar output. */
  output(group: OG, sources: readonly SourcePort[]): void;
  output(name: O, source: SourcePort): void;
};

const RESERVED_INSTANCE_NAMES = new Set(["inputs", "outputs"]);

/**
 * Defines a composite circuit built from other components.
 *
 * The builder callback runs immediately, exactly once, and the result is
 * validated before `circuit()` returns, so most mistakes are reported where the
 * circuit is defined. A wire loop through pass-through parts (one with no gate
 * on it) is the exception: it is only caught when the circuit is elaborated or
 * simulated. A circuit can only contain definitions that already
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
export function circuit<const I extends readonly PortDeclaration[], const O extends readonly PortDeclaration[]>(
  spec: CircuitSpec<I, O>,
  build: (builder: CircuitBuilder<PinName<I>, PinName<O>, GroupName<I>, GroupName<O>>) => void,
): ComponentDefinition<PinName<I>, PinName<O>, GroupName<I>, GroupName<O>> {
  if (typeof spec !== "object" || spec === null) {
    throw new CircuitError("circuit() expects a specification object");
  }
  assertName(spec.name, "circuit name");
  const { inputs, outputs } = validatePortLists(spec.name, spec.inputs, spec.outputs, "composite");
  if (typeof build !== "function") {
    throw new CircuitError("circuit() expects a builder function", spec.name);
  }

  const definition = Object.freeze({
    kind: "composite" as const,
    name: spec.name,
    inputs: inputs.names,
    outputs: outputs.names,
    inputGroups: inputs.groups,
    outputGroups: outputs.groups,
    describe: (): ComponentDescription => describeAt(definition, "root", "root", null),
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
    groups: GroupMembers<string, string>,
    direction: D,
    role: R,
  ) => {
    const pins = Object.fromEntries(names.map((n) => [n, makePort(owner, n, direction, role)]));
    for (const [name, members] of Object.entries(groups)) {
      // A group is a view, not another pin: iteration still visits each port exactly once.
      Object.defineProperty(pins, name, { value: Object.freeze(members.map((pin) => pins[pin]!)) });
    }
    return Object.freeze(pins);
  };

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

  /** Expand a grouped assignment into the very same connections as individual calls. */
  const wiresFor = (target: Port | readonly Port[], value: unknown, where: string): Connection[] => {
    if ("kind" in target) return [{ destination: target, source: checkSource(value, where) }];
    if (!Array.isArray(value)) return fail(`${where} expects an array of ${target.length} source ports`);
    if (value.length !== target.length) return fail(`${where} expects ${target.length} source ports, got ${value.length}`);
    return target.map((destination, i) => ({ destination, source: checkSource(value[i], label(destination)) }));
  };

  /** Check the entire assignment before recording it, including overlapping flat and group names. */
  const connect = (wires: readonly Connection[]): void => {
    const batch = new Map<Port, Connection>();
    for (const wire of wires) {
      const existing = drivers.get(wire.destination) ?? batch.get(wire.destination);
      if (existing !== undefined) {
        fail(
          `${label(wire.destination)} has multiple drivers (${label(existing.source)} and ${label(wire.source)}); ` +
            `each input or output may have only one driver`,
        );
      }
      batch.set(wire.destination, wire);
    }
    for (const wire of wires) {
      drivers.set(wire.destination, wire);
      connections.push(wire);
    }
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
    handle.inputs = portsOf(handle, child.inputs, child.inputGroups, "input", "sink");
    handle.outputs = portsOf(handle, child.outputs, child.outputGroups, "output", "source");
    const instance = Object.freeze(handle) as ComponentInstance;

    const wires: Connection[] = [];
    if (inputs !== undefined) {
      if (typeof inputs !== "object" || inputs === null) {
        fail(`add(${child.name}, "${name}", ...) expects its inputs as an object like { a: inputs.a }`);
      }
      const given = inputs as Record<string, unknown>;
      for (const key of Object.keys(given)) {
        if (!Object.hasOwn(instance.inputs, key)) {
          fail(`${child.name} has no input "${key}" (its inputs are ${child.inputs.join(", ") || "none"})`);
        }
      }
      for (const key of [...child.inputs, ...Object.keys(child.inputGroups)]) {
        if (!Object.hasOwn(given, key)) continue;
        for (const wire of wiresFor(instance.inputs[key]!, given[key], `${name}.inputs.${key}`)) wires.push(wire);
      }
    }
    // A wiring getter can itself add parts. Check the name after reading all the sources.
    if (instancesByName.has(name)) fail(`Duplicate component instance name "${name}"`);
    connect(wires);
    instancesByName.set(name, instance);
    instanceRecords.push(Object.freeze({ name, definition: child }));
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
    connect([{ destination, source: checkSource(source, label(destination)) }]);
  };

  const ownOutputs = portsOf(scope, definition.outputs, definition.outputGroups, "output", "sink");
  const output = (name: string, source: unknown): void => {
    if (sealed) fail("output() called after the circuit builder finished");
    if (typeof name !== "string" || !Object.hasOwn(ownOutputs, name)) {
      fail(`"${String(name)}" is not an output of ${circuitName} (its outputs are ${definition.outputs.join(", ") || "none"})`);
    }
    connect(wiresFor(ownOutputs[name]!, source, `outputs.${name}`));
  };

  const builder: CircuitBuilder<string, string> = Object.freeze({
    inputs: portsOf(scope, definition.inputs, definition.inputGroups, "input", "source"),
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
