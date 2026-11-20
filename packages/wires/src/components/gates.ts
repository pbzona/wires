// Standard components use only the public API exported from the package entry.
import { circuit, gate } from "../index.js";

/**
 * The only primitive in the standard library. Every other standard component
 * is a network of NAND gates built with `circuit()`.
 *
 * | a | b | out |
 * |---|---|---|
 * | 0 | * | 1 |
 * | * | 0 | 1 |
 * | 1 | 1 | 0 |
 * | otherwise | | X |
 */
export const NAND = gate({
  name: "NAND",
  inputs: ["a", "b"],
  outputs: ["out"],
  evaluate: ({ a, b }) => ({
    out: a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : "X",
  }),
});

/** out = NOT a, as NAND(a, a). */
export const NOT = circuit({ name: "NOT", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const g = add(NAND, "g", { a: inputs.a, b: inputs.a });
  output("out", g.outputs.out);
});

/** out = a AND b, as NOT(NAND(a, b)). */
export const AND = circuit({ name: "AND", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const nand = add(NAND, "nand", { a: inputs.a, b: inputs.b });
  const not = add(NOT, "not", { a: nand.outputs.out });
  output("out", not.outputs.out);
});

/** out = a OR b, as NAND(NOT a, NOT b). */
export const OR = circuit({ name: "OR", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const notA = add(NOT, "notA", { a: inputs.a });
  const notB = add(NOT, "notB", { a: inputs.b });
  const nand = add(NAND, "nand", { a: notA.outputs.out, b: notB.outputs.out });
  output("out", nand.outputs.out);
});

/** out = NOT (a OR b). */
export const NOR = circuit({ name: "NOR", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const or = add(OR, "or", { a: inputs.a, b: inputs.b });
  const not = add(NOT, "not", { a: or.outputs.out });
  output("out", not.outputs.out);
});

/** out = a XOR b, using the classic four-NAND network. */
export const XOR = circuit({ name: "XOR", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const n1 = add(NAND, "n1", { a: inputs.a, b: inputs.b });
  const n2 = add(NAND, "n2", { a: inputs.a, b: n1.outputs.out });
  const n3 = add(NAND, "n3", { a: inputs.b, b: n1.outputs.out });
  const n4 = add(NAND, "n4", { a: n2.outputs.out, b: n3.outputs.out });
  output("out", n4.outputs.out);
});

/** out = NOT (a XOR b). */
export const XNOR = circuit({ name: "XNOR", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const xor = add(XOR, "xor", { a: inputs.a, b: inputs.b });
  const not = add(NOT, "not", { a: xor.outputs.out });
  output("out", not.outputs.out);
});
