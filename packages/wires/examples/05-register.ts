// Two eight-bit registers on the same clock.
// Run: pnpm build && node examples/05-register.ts
import { simulate } from "@pbzona/wires";
import { RegisterPair } from "./Register8.ts";

// Simulation uses scalar pins. Print each word with bit 7 at the left.
let sim = simulate(RegisterPair);
const positions = [7, 6, 5, 4, 3, 2, 1, 0] as const;
const show = (label: string) => {
  const first = positions.map((i) => sim.read(`firstQ${i}`)).join("");
  const second = positions.map((i) => sim.read(`secondQ${i}`)).join("");
  console.log(`${label.padEnd(22)} first=${first}  second=${second}`);
};

sim = sim.set({ clock: 0, load: 1, d7: 1, d6: 0, d5: 0, d4: 0, d3: 0, d2: 0, d1: 0, d0: 0 }).run();
show("before first edge");
sim = sim.set({ clock: 1 }).run();
show("first rising edge");

sim = sim.set({ clock: 0 }).run();
sim = sim.set({ d7: 0, d0: 1 }).run(); // Settle the new word before the edge.
sim = sim.set({ clock: 1 }).run();
show("second rising edge");

sim = sim.set({ clock: 0 }).run();
sim = sim.set({ load: 0 }).run();
sim = sim.set({ clock: 1 }).run();
show("edge with load off");
