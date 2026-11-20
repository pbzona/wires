// Composing circuits from NAND, then inspecting topology, state and trace.
// Run: pnpm build && node examples/02-composition.ts
import { circuit, simulate } from "@pbzona/wires";
import { NAND } from "@pbzona/wires/components";

const NOT = circuit({ name: "NOT", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const g = add(NAND, "g", { a: inputs.a, b: inputs.a });
  output("out", g.outputs.out);
});

const AND = circuit({ name: "AND", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const nand = add(NAND, "nand", { a: inputs.a, b: inputs.b });
  const not = add(NOT, "not", { a: nand.outputs.out });
  output("out", not.outputs.out);
});

let sim = simulate(AND, { trace: true });
sim = sim.set({ a: 1, b: 1 }).run();
console.log(`out: ${sim.read("out")} (settled at tick ${sim.tick})`);

sim = sim.set({ a: 0 }).run();
console.log(`out after a = 0: ${sim.read("out")}`);

console.log("\nComponents:", AND.describe().components.map((c) => `${c.id} (${c.definition})`));
console.log("\nWires:");
for (const [id, wire] of Object.entries(sim.inspect().wires)) {
  console.log(`  ${id} = ${wire.value}  (${wire.ports.length} ports)`);
}
console.log("\nTrace:");
for (const t of sim.trace()) console.log(`  @${t.tick} ${t.wire}: ${t.previous} -> ${t.value}`);
