import { describe, expect, it } from "vitest";
import { NAND, NOT, SRLatch } from "wires/components";
import { StabilizationError, circuit, simulate } from "wires";

/** NAND(enable, feedback) followed by two inverters, fed back: a three-stage ring oscillator. */
const RingOscillator = circuit(
  { name: "RingOscillator", inputs: ["enable"], outputs: ["out"] },
  ({ inputs, add, feed, output }) => {
    const gate = add(NAND, "gate", { a: inputs.enable }); // b is fed back from inv2, below
    const inv1 = add(NOT, "inv1", { a: gate.outputs.out });
    const inv2 = add(NOT, "inv2", { a: inv1.outputs.out });
    feed(gate.inputs.b, inv2.outputs.out);
    output("out", inv2.outputs.out);
  },
);

const catchStabilization = (fn: () => unknown): StabilizationError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof StabilizationError) return error;
    throw error;
  }
  throw new Error("expected a StabilizationError");
};

describe("SR latch", () => {
  it("sets", () => {
    expect(simulate(SRLatch).set({ setN: 0, resetN: 1 }).run().readAll()).toEqual({ q: 1, qBar: 0 });
  });

  it("resets", () => {
    expect(simulate(SRLatch).set({ setN: 1, resetN: 0 }).run().readAll()).toEqual({ q: 0, qBar: 1 });
  });

  it("retains its state while both controls are inactive", () => {
    let latch = simulate(SRLatch).set({ setN: 0, resetN: 1 }).run();
    latch = latch.set({ setN: 1 }).run();
    expect(latch.readAll()).toEqual({ q: 1, qBar: 0 });

    latch = latch.set({ resetN: 0 }).run().set({ resetN: 1 }).run();
    expect(latch.readAll()).toEqual({ q: 0, qBar: 1 });

    // Further idle ticks change nothing.
    let idle = latch;
    for (let i = 0; i < 5; i++) idle = idle.step();
    expect(idle.readAll()).toEqual({ q: 0, qBar: 1 });
    expect(idle.stable).toBe(true);
  });

  it("stays unknown when never initialized", () => {
    const start = simulate(SRLatch).set({ setN: 1, resetN: 1 });
    const settled = start.run();
    expect(settled.tick).toBeGreaterThan(start.tick);
    expect(settled.readAll()).toEqual({ q: "X", qBar: "X" });
    expect(settled.stable).toBe(true);
  });

  it("does not treat the forbidden input combination as valid stored state", () => {
    const forbidden = simulate(SRLatch, { maxTicks: 50 }).set({ setN: 0, resetN: 1 }).run().set({ setN: 0, resetN: 0 }).run();
    // Both outputs high: not a complementary, storable state.
    expect(forbidden.readAll()).toEqual({ q: 1, qBar: 1 });
    // Releasing both at once races; the simulator reports it rather than picking a winner.
    expect(() => forbidden.set({ setN: 1, resetN: 1 }).run()).toThrow(StabilizationError);
  });
});

describe("feedback loops", () => {
  it("settles an uninitialized loop into a stable unknown state", () => {
    const settled = simulate(RingOscillator).run();
    expect(settled.tick).toBe(1);
    expect(settled.read("out")).toBe("X");
  });

  it("is stable while disabled", () => {
    expect(simulate(RingOscillator).set({ enable: 0 }).run().read("out")).toBe(1);
  });

  it("stops an oscillating loop at the tick limit with a descriptive error", () => {
    const disabled = simulate(RingOscillator, { maxTicks: 100 }).set({ enable: 0 }).run();
    const enabled = disabled.set({ enable: 1 });
    const error = catchStabilization(() => enabled.run());

    expect(error.ticksExecuted).toBe(100);
    expect(error.maxTicks).toBe(100);
    expect(error.tick).toBe(disabled.tick + 100);
    expect(error.recentChanges.length).toBeGreaterThan(0);
    expect(new Set(error.recentChanges.map((t) => t.wire))).toEqual(
      new Set(["root.gate.outputs.out", "root.inv1.g.outputs.out", "root.inv2.g.outputs.out"]),
    );
    expect(error.components).toEqual(["root.gate", "root.inv1.g", "root.inv2.g"]);
    expect(error.message).toMatch(/did not stabilize after 100 ticks/);
    expect(error.message).toMatch(/root\.inv2\.g/);

    // States are never changed, so the one before the failing run is still usable.
    expect(enabled.set({ enable: 0 }).run().read("out")).toBe(1);
  });

  it("applies the limit per run() call", () => {
    const enabled = simulate(RingOscillator, { maxTicks: 10 }).set({ enable: 0 }).run().set({ enable: 1 });
    expect(() => enabled.run()).toThrow(StabilizationError);
    let later = enabled;
    for (let i = 0; i < 25; i++) later = later.step();
    expect(() => later.run()).toThrow(/after 10 ticks/);
  });

  it("can be stepped while oscillating", () => {
    let sim = simulate(RingOscillator, { trace: true }).set({ enable: 0 }).run().set({ enable: 1 });
    for (let i = 0; i < 24; i++) sim = sim.step();
    // Three stages, one tick each: the output toggles every three ticks.
    const toggles = sim.trace().filter((t) => t.wire === "root.inv2.g.outputs.out" && t.previous !== "X");
    expect(toggles.length).toBeGreaterThanOrEqual(6);
    const gaps = toggles.slice(1).map((t, i) => t.tick - toggles[i]!.tick);
    expect(new Set(gaps)).toEqual(new Set([3]));
    expect(toggles.map((t) => t.value)).toEqual(toggles.map((_, i) => (i % 2 === 0 ? 0 : 1)));
  });
});
