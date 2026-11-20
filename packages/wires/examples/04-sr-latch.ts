// Sequential logic: a NAND SR latch remembers one bit.
// Run: pnpm build && node examples/04-sr-latch.ts
import { simulate, StabilizationError } from "wires";
import { SRLatch } from "wires/components";

const latch = simulate(SRLatch, { maxTicks: 100 });
const show = (label: string) => {
  latch.run();
  const { q, qBar } = latch.readAll();
  console.log(`${label.padEnd(28)} q=${q} qBar=${qBar}`);
};

latch.set({ setN: 1, resetN: 1 });
show("power on (hold)");
latch.set({ setN: 0 });
show("set (setN = 0)");
latch.set({ setN: 1 });
show("hold: remembers 1");
latch.set({ resetN: 0 });
show("reset (resetN = 0)");
latch.set({ resetN: 1 });
show("hold: remembers 0");
latch.set({ setN: 0, resetN: 0 });
show("forbidden (both 0)");

latch.set({ setN: 1, resetN: 1 });
try {
  latch.run();
} catch (error) {
  if (!(error instanceof StabilizationError)) throw error;
  console.log(`release both at once: oscillates, stopped after ${error.ticksExecuted} ticks`);
  console.log(`  components involved: ${error.components.join(", ")}`);
}
