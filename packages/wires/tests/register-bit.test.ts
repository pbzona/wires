import { describe, expect, it } from "vitest";
import { elaborate, simulate } from "@pbzona/wires";
import { RegisterBit } from "@pbzona/wires/components";

describe("RegisterBit", () => {
  it("first publishes data after the rising edge has propagated through gates", () => {
    const ready = simulate(RegisterBit).set({ d: 1, clock: 0, load: 1 }).run();
    expect(ready.read("q")).toBe("X");

    const edge = ready.set({ clock: 1 }).step();
    expect(edge.read("q")).toBe("X");
    const high = edge.run();
    expect(high.read("q")).toBe(1);

    const changed = high.set({ d: 0 }).run();
    expect(changed.read("q")).toBe(1);
    const low = changed.set({ clock: 0 }).run();
    expect(low.read("q")).toBe(1);
    expect(low.set({ clock: 1 }).run().read("q")).toBe(0);
  });

  it("holds a stored bit with load off, even when d is unknown", () => {
    let sim = simulate(RegisterBit).set({ d: 1, clock: 0, load: 1 }).run().set({ clock: 1 }).run();
    sim = sim.set({ clock: 0 }).run().set({ load: 0, d: "X" }).run();
    expect(sim.set({ clock: 1 }).run().read("q")).toBe(1);
    // The same unknown data really is captured when loading is enabled.
    expect(sim.set({ load: 1 }).run().set({ clock: 1 }).run().read("q")).toBe("X");
  });

  it("uses only NAND primitives", () => {
    const { gates } = elaborate(RegisterBit);
    expect(new Set(gates.map((gate) => gate.definition))).toEqual(new Set(["NAND"]));
  });
});
