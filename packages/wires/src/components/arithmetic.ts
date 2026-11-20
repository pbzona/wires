import { circuit } from "../index.js";
import { AND, OR, XOR } from "./gates.js";

/** Adds two bits: sum = a XOR b, carry = a AND b. */
export const HalfAdder = circuit(
  { name: "HalfAdder", inputs: ["a", "b"], outputs: ["sum", "carry"] },
  ({ inputs, outputs, add, connect }) => {
    const xor = add(XOR, "xor");
    const and = add(AND, "and");
    connect(inputs.a, xor.inputs.a);
    connect(inputs.b, xor.inputs.b);
    connect(inputs.a, and.inputs.a);
    connect(inputs.b, and.inputs.b);
    connect(xor.outputs.out, outputs.sum);
    connect(and.outputs.out, outputs.carry);
  },
);

/** Adds three bits, built from two half adders and an OR gate. */
export const FullAdder = circuit(
  { name: "FullAdder", inputs: ["a", "b", "carryIn"], outputs: ["sum", "carryOut"] },
  ({ inputs, outputs, add, connect }) => {
    const first = add(HalfAdder, "first");
    const second = add(HalfAdder, "second");
    const or = add(OR, "or");
    connect(inputs.a, first.inputs.a);
    connect(inputs.b, first.inputs.b);
    connect(first.outputs.sum, second.inputs.a);
    connect(inputs.carryIn, second.inputs.b);
    connect(first.outputs.carry, or.inputs.a);
    connect(second.outputs.carry, or.inputs.b);
    connect(second.outputs.sum, outputs.sum);
    connect(or.outputs.out, outputs.carryOut);
  },
);
