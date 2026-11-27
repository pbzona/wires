import { bits, circuit } from "@pbzona/wires";
import { RegisterBit } from "@pbzona/wires/components";

// Eight independent cells share a clock and load control.
export const Register8 = circuit(
  { name: "Register8", inputs: [bits("d", 8), "clock", "load"], outputs: [bits("q", 8)] },
  ({ inputs, add, output }) => {
    const cells = inputs.d.map((d, i) =>
      add(RegisterBit, `bit${i}`, { d, clock: inputs.clock, load: inputs.load }),
    );
    output("q", cells.map((cell) => cell.outputs.q));
  },
);

// Both registers capture on the same rising edge: second captures the old first word.
export const RegisterPair = circuit(
  { name: "RegisterPair", inputs: [bits("d", 8), "clock", "load"], outputs: [bits("firstQ", 8), bits("secondQ", 8)] },
  ({ inputs, add, output }) => {
    const { d, clock, load } = inputs;
    const first = add(Register8, "first", { d, clock, load });
    const second = add(Register8, "second", { d: first.outputs.q, clock, load });
    output("firstQ", first.outputs.q);
    output("secondQ", second.outputs.q);
  },
);
