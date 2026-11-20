// A four-bit ripple-carry adder built from standard full adders.
// Run: pnpm build && node examples/03-four-bit-adder.ts
import { circuit, elaborate, simulate, type Signal, type SourcePort } from "wires";
import { FullAdder } from "wires/components";

const Adder4 = circuit(
  {
    name: "Adder4",
    inputs: ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3", "carryIn"],
    outputs: ["s0", "s1", "s2", "s3", "carryOut"],
  },
  ({ inputs, outputs, add, connect }) => {
    let carry: SourcePort = inputs.carryIn;
    for (const i of [0, 1, 2, 3] as const) {
      const fa = add(FullAdder, `fa${i}`);
      connect(inputs[`a${i}`], fa.inputs.a);
      connect(inputs[`b${i}`], fa.inputs.b);
      connect(carry, fa.inputs.carryIn);
      connect(fa.outputs.sum, outputs[`s${i}`]);
      carry = fa.outputs.carryOut;
    }
    connect(carry, outputs.carryOut);
  },
);

const bits = (prefix: string, n: number) =>
  Object.fromEntries([0, 1, 2, 3].map((i) => [`${prefix}${i}`, ((n >> i) & 1) as Signal]));

const sim = simulate(Adder4);
for (const [a, b] of [[3, 4], [7, 9], [15, 15]] as const) {
  sim.set({ ...bits("a", a), ...bits("b", b), carryIn: 0 });
  const { ticks } = sim.run();
  const o = sim.readAll();
  const sum = [o.s0, o.s1, o.s2, o.s3, o.carryOut].reduce<number>((acc, bit, i) => acc + Number(bit) * 2 ** i, 0);
  console.log(`${a} + ${b} = ${sum}  (settled in ${ticks} ticks)`);
}
console.log(`NAND gates: ${elaborate(Adder4).gates.length}`);
