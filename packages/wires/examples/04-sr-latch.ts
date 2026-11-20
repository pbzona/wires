// Sequential logic: a NAND SR latch remembers one bit.
// Run: pnpm build && node examples/04-sr-latch.ts
import { simulate, StabilizationError, type Signal } from "@pbzona/wires";
import { SRLatch } from "@pbzona/wires/components";

type Inputs = { setN?: Signal; resetN?: Signal };

let latch = simulate(SRLatch, { maxTicks: 100 });
const apply = (label: string, inputs: Inputs) => {
  latch = latch.set(inputs).run();
  const { q, qBar } = latch.readAll();
  console.log(`${label.padEnd(28)} q=${q} qBar=${qBar}`);
};

apply("power on (hold)", { setN: 1, resetN: 1 });
apply("set (setN = 0)", { setN: 0 });
apply("hold: remembers 1", { setN: 1 });
const remembersOne = latch;
apply("reset (resetN = 0)", { resetN: 0 });
apply("hold: remembers 0", { resetN: 1 });
console.log(`${"earlier state, unchanged".padEnd(28)} q=${remembersOne.read("q")}`);
apply("forbidden (both 0)", { setN: 0, resetN: 0 });

try {
  latch.set({ setN: 1, resetN: 1 }).run();
} catch (error) {
  if (!(error instanceof StabilizationError)) throw error;
  console.log(`release both at once: oscillates, stopped after ${error.ticksExecuted} ticks`);
  console.log(`  components involved: ${error.components.join(", ")}`);
}
