// Defining a primitive gate and simulating it.
// Run: pnpm build && node examples/01-gates.ts
import { gate, simulate, type Signal } from "wires";

const NAND = gate({
  name: "NAND",
  inputs: ["a", "b"],
  outputs: ["out"],
  evaluate: ({ a, b }) => ({
    out: a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : "X",
  }),
});

const start = simulate(NAND);
const values: Signal[] = [0, 1, "X"];

console.log("a b | NAND");
for (const a of values) {
  for (const b of values) {
    // Every row starts from the same initial state: states never change.
    const settled = start.set({ a, b }).run();
    console.log(`${a} ${b} | ${settled.read("out")}`);
  }
}
