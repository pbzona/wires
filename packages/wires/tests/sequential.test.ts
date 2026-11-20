import { describe, expect, it } from "vitest";
import { NAND, NOT, SRLatch } from "wires/components";
import { StabilizationError, circuit, simulate } from "wires";

/** NAND(enable, feedback) followed by two inverters, fed back: a three-stage ring oscillator. */
const RingOscillator = circuit(
  { name: "RingOscillator", inputs: ["enable"], outputs: ["out"] },
  ({ inputs, outputs, add, connect }) => {
    const gate = add(NAND, "gate");
    const inv1 = add(NOT, "inv1");
    const inv2 = add(NOT, "inv2");
    connect(inputs.enable, gate.inputs.a);
    connect(inv2.outputs.out, gate.inputs.b);
    connect(gate.outputs.out, inv1.inputs.a);
    connect(inv1.outputs.out, inv2.inputs.a);
    connect(inv2.outputs.out, outputs.out);
  },
);

describe("SR latch", () => {
  it("sets", () => {
    const sim = simulate(SRLatch);
    sim.set({ setN: 0, resetN: 1 });
    sim.run();
    expect(sim.readAll()).toEqual({ q: 1, qBar: 0 });
  });

  it("resets", () => {
    const sim = simulate(SRLatch);
    sim.set({ setN: 1, resetN: 0 });
    sim.run();
    expect(sim.readAll()).toEqual({ q: 0, qBar: 1 });
  });

  it("retains its state while both controls are inactive", () => {
    const sim = simulate(SRLatch);
    sim.set({ setN: 0, resetN: 1 });
    sim.run();
    sim.set({ setN: 1 });
    sim.run();
    expect(sim.readAll()).toEqual({ q: 1, qBar: 0 });

    sim.set({ resetN: 0 });
    sim.run();
    sim.set({ resetN: 1 });
    sim.run();
    expect(sim.readAll()).toEqual({ q: 0, qBar: 1 });

    // Further idle ticks change nothing.
    for (let i = 0; i < 5; i++) sim.tick();
    expect(sim.readAll()).toEqual({ q: 0, qBar: 1 });
    expect(sim.inspect().stable).toBe(true);
  });

  it("stays unknown when never initialized", () => {
    const sim = simulate(SRLatch);
    sim.set({ setN: 1, resetN: 1 });
    const result = sim.run();
    expect(result.ticks).toBeGreaterThan(0);
    expect(sim.readAll()).toEqual({ q: "X", qBar: "X" });
    expect(sim.inspect().stable).toBe(true);
  });

  it("does not treat the forbidden input combination as valid stored state", () => {
    const sim = simulate(SRLatch, { maxTicks: 50 });
    sim.set({ setN: 0, resetN: 1 });
    sim.run();
    sim.set({ setN: 0, resetN: 0 });
    sim.run();
    // Both outputs high: not a complementary, storable state.
    expect(sim.readAll()).toEqual({ q: 1, qBar: 1 });
    // Releasing both at once races; the simulator reports it rather than picking a winner.
    sim.set({ setN: 1, resetN: 1 });
    expect(() => sim.run()).toThrow(StabilizationError);
  });
});

describe("feedback loops", () => {
  it("settles an uninitialized loop into a stable unknown state", () => {
    const sim = simulate(RingOscillator);
    expect(sim.run().ticks).toBe(1);
    expect(sim.read("out")).toBe("X");
  });

  it("is stable while disabled", () => {
    const sim = simulate(RingOscillator);
    sim.set({ enable: 0 });
    sim.run();
    expect(sim.read("out")).toBe(1);
  });

  it("stops an oscillating loop at the tick limit with a descriptive error", () => {
    const sim = simulate(RingOscillator, { maxTicks: 100 });
    sim.set({ enable: 0 });
    const settled = sim.run();
    sim.set({ enable: 1 });

    let error: StabilizationError | undefined;
    try {
      sim.run();
    } catch (e) {
      error = e as StabilizationError;
    }
    expect(error).toBeInstanceOf(StabilizationError);
    expect(error!.ticksExecuted).toBe(100);
    expect(error!.maxTicks).toBe(100);
    expect(error!.tick).toBe(settled.tick + 100);
    expect(error!.recentChanges.length).toBeGreaterThan(0);
    expect(new Set(error!.recentChanges.map((t) => t.signalId))).toEqual(
      new Set(["root.gate.outputs.out", "root.inv1.g.outputs.out", "root.inv2.g.outputs.out"]),
    );
    expect(error!.components).toEqual(["root.gate", "root.inv1.g", "root.inv2.g"]);
    expect(error!.message).toMatch(/did not stabilize after 100 ticks/);
    expect(error!.message).toMatch(/root\.inv2\.g/);

    // The simulator stays usable: disabling the oscillator lets it settle again.
    sim.set({ enable: 0 });
    expect(() => sim.run()).not.toThrow();
    expect(sim.read("out")).toBe(1);
  });

  it("applies the limit per run() call", () => {
    const sim = simulate(RingOscillator, { maxTicks: 10 });
    sim.set({ enable: 0 });
    sim.run();
    sim.set({ enable: 1 });
    expect(() => sim.run()).toThrow(StabilizationError);
    expect(() => sim.run()).toThrow(/after 10 ticks/);
  });

  it("can be single-stepped while oscillating", () => {
    const sim = simulate(RingOscillator, { trace: true });
    sim.set({ enable: 0 });
    sim.run();
    sim.set({ enable: 1 });
    for (let i = 0; i < 24; i++) sim.tick();
    // Three stages, one tick each: the output toggles every three ticks.
    const toggles = sim.trace().filter((t) => t.signalId === "root.inv2.g.outputs.out" && t.previous !== "X");
    expect(toggles.length).toBeGreaterThanOrEqual(6);
    const gaps = toggles.slice(1).map((t, i) => t.tick - toggles[i]!.tick);
    expect(new Set(gaps)).toEqual(new Set([3]));
    expect(toggles.map((t) => t.value)).toEqual(toggles.map((_, i) => (i % 2 === 0 ? 0 : 1)));
  });
});
