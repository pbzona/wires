// A four-bit ripple-carry adder built from standard full adders.
// Run: pnpm build && node examples/03-four-bit-adder.ts
import { elaborate, simulate, type Signal } from "@pbzona/wires";
import { Adder4 } from "./Adder4.ts";

const bits = (prefix: string, n: number) =>
  Object.fromEntries([0, 1, 2, 3].map((i) => [`${prefix}${i}`, ((n >> i) & 1) as Signal]));

let sim = simulate(Adder4);
for (const [a, b] of [[3, 4], [7, 9], [15, 15]] as const) {
  const before = sim.set({ ...bits("a", a), ...bits("b", b), carryIn: 0 });
  sim = before.run();
  const o = sim.readAll();
  const sum = [o.s0, o.s1, o.s2, o.s3, o.carryOut].reduce<number>((acc, bit, i) => acc + Number(bit) * 2 ** i, 0);
  console.log(`${a} + ${b} = ${sum}  (settled in ${sim.tick - before.tick} ticks)`);
}
console.log(`NAND gates: ${elaborate(Adder4).gates.length}`);
