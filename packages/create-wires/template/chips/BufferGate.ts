import { circuit } from "@pbzona/wires";
import { NOT } from "@pbzona/wires/components";

// Two inversions restore the input after two NOT gate delays.
export const BufferGate = circuit(
  { name: "BufferGate", inputs: ["a"], outputs: ["out"] },
  ({ inputs, add, output }) => {
    const first = add(NOT, "first", { a: inputs.a });
    const second = add(NOT, "second", { a: first.outputs.out });
    output("out", second.outputs.out);
  },
);
