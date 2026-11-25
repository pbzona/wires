// A four-bit ripple-carry adder built from standard full adders.
import { circuit, type SourcePort } from "@pbzona/wires";
import { FullAdder } from "@pbzona/wires/components";

export const Adder4 = circuit(
  {
    name: "Adder4",
    inputs: ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3", "carryIn"],
    outputs: ["s0", "s1", "s2", "s3", "carryOut"],
  },
  ({ inputs, add, output }) => {
    let carry: SourcePort = inputs.carryIn;
    for (const i of [0, 1, 2, 3] as const) {
      const fa = add(FullAdder, `fa${i}`, { a: inputs[`a${i}`], b: inputs[`b${i}`], carryIn: carry });
      output(`s${i}`, fa.outputs.sum);
      carry = fa.outputs.carryOut;
    }
    output("carryOut", carry);
  },
);
