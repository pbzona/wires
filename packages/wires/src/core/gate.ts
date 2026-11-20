import {
  assertName,
  type ComponentDefinition,
  describeAt,
  type Evaluator,
  registerDefinition,
  validatePortLists,
} from "./component.js";
import { CircuitError } from "./errors.js";
import type { Signal } from "./signal.js";

/** Specification of a primitive gate. */
export type GateSpec<I extends readonly string[], O extends readonly string[]> = {
  readonly name: string;
  readonly inputs: I;
  readonly outputs: O;
  /**
   * Pure, synchronous evaluation function. Receives the current value of every
   * input and must return a value for every output, and nothing else.
   */
  readonly evaluate: (inputs: { readonly [K in I[number]]: Signal }) => { readonly [K in O[number]]: Signal };
};

/**
 * Defines a primitive gate with an explicit evaluation function.
 *
 * ```ts
 * const NAND = gate({
 *   name: "NAND",
 *   inputs: ["a", "b"],
 *   outputs: ["out"],
 *   evaluate: ({ a, b }) => ({ out: a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : "X" }),
 * });
 * ```
 */
export function gate<const I extends readonly string[], const O extends readonly string[]>(
  spec: GateSpec<I, O>,
): ComponentDefinition<I[number], O[number]> {
  if (typeof spec !== "object" || spec === null) {
    throw new CircuitError("gate() expects a specification object");
  }
  assertName(spec.name, "gate name");
  const { inputs, outputs } = validatePortLists(spec.name, spec.inputs, spec.outputs);
  if (typeof spec.evaluate !== "function") {
    throw new CircuitError("evaluate must be a function", spec.name);
  }

  const definition: ComponentDefinition<I[number], O[number]> = Object.freeze({
    kind: "primitive" as const,
    name: spec.name,
    inputs: inputs as readonly I[number][],
    outputs: outputs as readonly O[number][],
    describe: () => describeAt(definition, "root", "root", null),
  });
  registerDefinition(definition, { kind: "primitive", evaluate: spec.evaluate as Evaluator });
  return definition;
}
