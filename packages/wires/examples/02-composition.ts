// Composing circuits from NAND, then inspecting topology, state and trace.
// Run: pnpm build && node examples/02-composition.ts
import { circuit, simulate } from "wires";
import { NAND } from "wires/components";

const NOT = circuit({ name: "NOT", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
  const g = add(NAND, "g");
  connect(inputs.a, g.inputs.a);
  connect(inputs.a, g.inputs.b);
  connect(g.outputs.out, outputs.out);
});

const AND = circuit({ name: "AND", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
  const nand = add(NAND, "nand");
  const not = add(NOT, "not");
  connect(inputs.a, nand.inputs.a);
  connect(inputs.b, nand.inputs.b);
  connect(nand.outputs.out, not.inputs.a);
  connect(not.outputs.out, outputs.out);
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
