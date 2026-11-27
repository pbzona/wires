import { describe, expect, it } from "vitest";
import { simulate } from "@pbzona/wires";
import { Register8, RegisterPair } from "../examples/Register8.ts";

const positions = [7, 6, 5, 4, 3, 2, 1, 0] as const;

describe("Register8", () => {
  it("connects each d pin to the matching q pin", () => {
    let sim = simulate(Register8)
      .set({ clock: 0, load: 1, d7: 0, d6: 0, d5: 0, d4: 0, d3: 0, d2: 0, d1: 0, d0: 0 }).run();
    for (const hot of positions) {
      sim = sim.set({ [`d${hot}`]: 1 } as const).run().set({ clock: 1 }).run();
      for (const i of positions) expect(sim.read(`q${i}`)).toBe(i === hot ? 1 : 0);
      sim = sim.set({ clock: 0 }).run().set({ [`d${hot}`]: 0 } as const).run();
    }
  });

  it("transfers the first register's previous word on each shared rising edge", () => {
    let sim = simulate(RegisterPair)
      .set({ clock: 0, load: 1, d7: "X", d6: 0, d5: 0, d4: 0, d3: 0, d2: 0, d1: 0, d0: 1 }).run();
    const words = () => [
      positions.map((i) => sim.read(`firstQ${i}`)).join(""),
      positions.map((i) => sim.read(`secondQ${i}`)).join(""),
    ];

    sim = sim.set({ clock: 1 }).run();
    expect(words()).toEqual(["X0000001", "XXXXXXXX"]);
    sim = sim.set({ clock: 0 }).run().set({ d7: 1, d0: 0 }).run();
    expect(words()).toEqual(["X0000001", "XXXXXXXX"]);
    sim = sim.set({ clock: 1 }).run();
    expect(words()).toEqual(["10000000", "X0000001"]);

    sim = sim.set({ clock: 0 }).run().set({ load: 0, d7: 0, d0: 1 }).run();
    sim = sim.set({ clock: 1 }).run();
    expect(words()).toEqual(["10000000", "X0000001"]); // Both registers ignore new input.
  });
});
