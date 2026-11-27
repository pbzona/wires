import { CircuitError } from "./errors.js";
import type { GroupMembers } from "./port-lists.js";
import { describeValue, type Signal } from "./signal.js";

/** Direction of a port as seen from outside its component. */
export type Direction = "input" | "output";

/**
 * Role of a port inside the circuit currently being built.
 *
 * Sources: the circuit's own inputs and its children's outputs.
 * Sinks: the circuit's own outputs and its children's inputs.
 */
export type PortRole = "source" | "sink";

/** The circuit currently being defined, as the owner of its own external ports. */
export interface CircuitScope {
  readonly kind: "scope";
  /** Name of the circuit definition being built. */
  readonly name: string;
}

/**
 * A named terminal on a component. Ports are structural references only; they
 * never hold simulation state.
 */
export interface Port<
  Name extends string = string,
  D extends Direction = Direction,
  R extends PortRole = PortRole,
> {
  readonly kind: "port";
  /** Identifier unique within the owning component, e.g. `"inputs.a"`. */
  readonly id: string;
  readonly name: Name;
  readonly direction: D;
  readonly role: R;
  /** The component instance (or the circuit being defined) that owns the port. */
  readonly owner: ComponentInstance | CircuitScope;
}

/** A port that can drive a connection in the current scope. */
export type SourcePort = Port<string, Direction, "source">;
/** A port that can be driven by a connection in the current scope. */
export type SinkPort = Port<string, Direction, "sink">;

/** Reusable, immutable definition of a primitive gate or a composite circuit. */
export interface ComponentDefinition<
  I extends string = string, O extends string = string,
  IG extends string = never, OG extends string = never,
> {
  readonly kind: "primitive" | "composite";
  readonly name: string;
  readonly inputs: readonly I[];
  readonly outputs: readonly O[];
  /** Named groups of pins, in bit order. Empty for scalar-only definitions. */
  readonly inputGroups: GroupMembers<IG, I>;
  readonly outputGroups: GroupMembers<OG, O>;
  /** Serializable topology of this definition, with hierarchical ids rooted at `"root"`. */
  describe(): ComponentDescription;
}

/** Flat pins and the named views over those same pins inside a circuit builder. */
export type PortHandles<P extends string, G extends string, D extends Direction, R extends PortRole> =
  { readonly [K in P]: Port<K, D, R> } & { readonly [K in G]: readonly Port<`${K}${number}`, D, R>[] };

/** One occurrence of a definition inside a circuit. */
export interface ComponentInstance<
  I extends string = string, O extends string = string,
  IG extends string = never, OG extends string = never,
> {
  readonly kind: "instance";
  /** Name of the instance, unique within its containing circuit. */
  readonly name: string;
  readonly definition: ComponentDefinition<I, O, IG, OG>;
  readonly inputs: PortHandles<I, IG, "input", "sink">;
  readonly outputs: PortHandles<O, OG, "output", "source">;
}

/** Serializable description of a port. */
export type PortDescription = {
  /** Hierarchical id, e.g. `"root.not.inputs.a"`. */
  readonly id: string;
  readonly name: string;
  readonly direction: Direction;
};

/** Serializable description of a connection, using hierarchical port ids. */
export type ConnectionDescription = {
  readonly source: string;
  readonly destination: string;
};

/** Serializable description of a component instance and everything inside it. */
export type ComponentDescription = {
  /** Stable hierarchical id, e.g. `"root"` or `"root.not.g"`. */
  readonly id: string;
  /** Instance name (`"root"` for the top level). */
  readonly name: string;
  /** Id of the containing component, or `null` at the top level. */
  readonly parent: string | null;
  /** Name of the definition this instance was created from. */
  readonly definition: string;
  readonly kind: "primitive" | "composite";
  readonly ports: readonly PortDescription[];
  /** Child instances (empty for primitives). */
  readonly components: readonly ComponentDescription[];
  /** Connections inside this component (empty for primitives). */
  readonly connections: readonly ConnectionDescription[];
};

// ---------------------------------------------------------------------------
// Internal representation (not exported from the package entry point).

/** Port reference inside a built circuit: `instance === null` means the circuit itself. */
export type PortRecord = {
  readonly instance: string | null;
  readonly direction: Direction;
  readonly name: string;
};

export type ConnectionRecord = {
  readonly source: PortRecord;
  readonly destination: PortRecord;
};

export type InstanceRecord = {
  readonly name: string;
  readonly definition: ComponentDefinition;
};

/** The frozen result of running a circuit's builder callback. */
export type CircuitStructure = {
  readonly instances: readonly InstanceRecord[];
  readonly connections: readonly ConnectionRecord[];
};

export type Evaluator = (inputs: Readonly<Record<string, Signal>>) => unknown;

export type PrimitiveInternals = {
  readonly kind: "primitive";
  readonly evaluate: Evaluator;
};

export type CompositeInternals = {
  readonly kind: "composite";
  /** The validated result of running the circuit's builder. */
  readonly structure: CircuitStructure;
};

const internals = new WeakMap<object, PrimitiveInternals | CompositeInternals>();

export function registerDefinition(
  definition: ComponentDefinition,
  data: PrimitiveInternals | CompositeInternals,
): void {
  internals.set(definition, data);
}

export function getInternals(definition: unknown): PrimitiveInternals | CompositeInternals | undefined {
  return typeof definition === "object" && definition !== null ? internals.get(definition) : undefined;
}

export function requireInternals(definition: unknown, context: string): PrimitiveInternals | CompositeInternals {
  const data = getInternals(definition);
  if (data === undefined) {
    throw new CircuitError(`${context} expects a component definition created with gate() or circuit()`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Names

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validates component, port and instance names: plain identifiers only. */
export function assertName(value: unknown, what: string, path?: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || value === "__proto__") {
    throw new CircuitError(
      `Invalid ${what} ${describeValue(value)}: names must be identifiers ` +
        `(letters, digits and underscores, not starting with a digit)`,
      path,
    );
  }
}

/** Hierarchical id of a port belonging to the instance at `instancePath`. */
export function portPath(instancePath: string, direction: Direction, name: string): string {
  return `${instancePath}.${direction === "input" ? "inputs" : "outputs"}.${name}`;
}

// ---------------------------------------------------------------------------
// Topology description

/** Describes `definition` as an instance at hierarchical `id`. */
export function describeAt(
  definition: ComponentDefinition,
  id: string,
  name: string,
  parent: string | null,
): ComponentDescription {
  const data = requireInternals(definition, "describe()");
  const ports: PortDescription[] = [
    ...definition.inputs.map((port) => ({ id: portPath(id, "input", port), name: port, direction: "input" as const })),
    ...definition.outputs.map((port) => ({ id: portPath(id, "output", port), name: port, direction: "output" as const })),
  ];
  if (data.kind === "primitive") {
    return { id, name, parent, definition: definition.name, kind: "primitive", ports, components: [], connections: [] };
  }
  const structure = data.structure;
  const resolve = (ref: PortRecord) =>
    portPath(ref.instance === null ? id : `${id}.${ref.instance}`, ref.direction, ref.name);
  return {
    id,
    name,
    parent,
    definition: definition.name,
    kind: "composite",
    ports,
    components: structure.instances.map((child) => describeAt(child.definition, `${id}.${child.name}`, child.name, id)),
    connections: structure.connections.map((c) => ({ source: resolve(c.source), destination: resolve(c.destination) })),
  };
}
