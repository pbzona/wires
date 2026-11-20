// Composing circuits from NAND, then inspecting topology, state and trace.
// Run: pnpm build && node examples/02-composition.ts
import { circuit, simulate } from "wires";
import { NAND } from "wires/components";

const NOT = circuit({ name: "NOT", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const g = add(NAND, "g", { a: inputs.a, b: inputs.a });
  output("out", g.outputs.out);
});

const AND = circuit({ name: "AND", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const nand = add(NAND, "nand", { a: inputs.a, b: inputs.b });
  const not = add(NOT, "not", { a: nand.outputs.out });
  output("out", not.outputs.out);
});

const sim = simulate(AND, { trace: true });
sim.set({ a: 1, b: 1 });
console.log("run:", sim.run());
console.log("out:", sim.read("out"));

sim.set({ a: 0 });
sim.run();
console.log("out after a = 0:", sim.read("out"));

console.log("\nComponents:", AND.describe().components.map((c) => `${c.id} (${c.definition})`));
console.log("\nState:", sim.inspect());
console.log("\nTrace:");
for (const t of sim.trace()) console.log(`  @${t.tick} ${t.signalId}: ${t.previous} -> ${t.value}`);
