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
export const NOT = circuit({ name: "NOT", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
  const g = add(NAND, "g");
  connect(inputs.a, g.inputs.a);
  connect(inputs.a, g.inputs.b);
  connect(g.outputs.out, outputs.out);
});

/** out = a AND b, as NOT(NAND(a, b)). */
export const AND = circuit(
  { name: "AND", inputs: ["a", "b"], outputs: ["out"] },
  ({ inputs, outputs, add, connect }) => {
    const nand = add(NAND, "nand");
    const not = add(NOT, "not");
    connect(inputs.a, nand.inputs.a);
    connect(inputs.b, nand.inputs.b);
    connect(nand.outputs.out, not.inputs.a);
    connect(not.outputs.out, outputs.out);
  },
);

/** out = a OR b, as NAND(NOT a, NOT b). */
export const OR = circuit(
  { name: "OR", inputs: ["a", "b"], outputs: ["out"] },
  ({ inputs, outputs, add, connect }) => {
    const notA = add(NOT, "notA");
    const notB = add(NOT, "notB");
    const nand = add(NAND, "nand");
    connect(inputs.a, notA.inputs.a);
    connect(inputs.b, notB.inputs.a);
    connect(notA.outputs.out, nand.inputs.a);
    connect(notB.outputs.out, nand.inputs.b);
    connect(nand.outputs.out, outputs.out);
  },
);

/** out = NOT (a OR b). */
export const NOR = circuit(
  { name: "NOR", inputs: ["a", "b"], outputs: ["out"] },
  ({ inputs, outputs, add, connect }) => {
    const or = add(OR, "or");
    const not = add(NOT, "not");
    connect(inputs.a, or.inputs.a);
    connect(inputs.b, or.inputs.b);
    connect(or.outputs.out, not.inputs.a);
    connect(not.outputs.out, outputs.out);
  },
);

/** out = a XOR b, using the classic four-NAND network. */
export const XOR = circuit(
  { name: "XOR", inputs: ["a", "b"], outputs: ["out"] },
  ({ inputs, outputs, add, connect }) => {
    const n1 = add(NAND, "n1");
    const n2 = add(NAND, "n2");
    const n3 = add(NAND, "n3");
    const n4 = add(NAND, "n4");
    connect(inputs.a, n1.inputs.a);
    connect(inputs.b, n1.inputs.b);
    connect(inputs.a, n2.inputs.a);
    connect(n1.outputs.out, n2.inputs.b);
    connect(inputs.b, n3.inputs.a);
    connect(n1.outputs.out, n3.inputs.b);
    connect(n2.outputs.out, n4.inputs.a);
    connect(n3.outputs.out, n4.inputs.b);
    connect(n4.outputs.out, outputs.out);
  },
);

/** out = NOT (a XOR b). */
export const XNOR = circuit(
  { name: "XNOR", inputs: ["a", "b"], outputs: ["out"] },
  ({ inputs, outputs, add, connect }) => {
    const xor = add(XOR, "xor");
    const not = add(NOT, "not");
    connect(inputs.a, xor.inputs.a);
    connect(inputs.b, xor.inputs.b);
    connect(xor.outputs.out, not.inputs.a);
    connect(not.outputs.out, outputs.out);
  },
);
