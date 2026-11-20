import { circuit } from "../index.js";
import { AND, OR, XOR } from "./gates.js";

/** Adds two bits: sum = a XOR b, carry = a AND b. */
export const HalfAdder = circuit(
  { name: "HalfAdder", inputs: ["a", "b"], outputs: ["sum", "carry"] },
  ({ inputs, add, output }) => {
    const xor = add(XOR, "xor", { a: inputs.a, b: inputs.b });
    const and = add(AND, "and", { a: inputs.a, b: inputs.b });
    output("sum", xor.outputs.out);
    output("carry", and.outputs.out);
  },
);

/** Adds three bits, built from two half adders and an OR gate. */
export const FullAdder = circuit(
  { name: "FullAdder", inputs: ["a", "b", "carryIn"], outputs: ["sum", "carryOut"] },
  ({ inputs, add, output }) => {
    const first = add(HalfAdder, "first", { a: inputs.a, b: inputs.b });
    const second = add(HalfAdder, "second", { a: first.outputs.sum, b: inputs.carryIn });
    const or = add(OR, "or", { a: first.outputs.carry, b: second.outputs.carry });
    output("sum", second.outputs.sum);
    output("carryOut", or.outputs.out);
  },
);
