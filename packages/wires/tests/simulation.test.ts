import { describe, expect, it } from "vitest";
import { AND, NAND, NOT, SRLatch, XOR } from "wires/components";
import {
  type ComponentDefinition,
  type ComponentInstance,
  SimulationError,
  type SimulationState,
  type SourcePort,
  circuit,
  elaborate,
  gate,
  simulate,
} from "wires";

const Wire = circuit({ name: "Wire", inputs: ["a"], outputs: ["out"] }, ({ inputs, output }) => {
  output("out", inputs.a);
});

describe("simulation states", () => {
  it("matches the README example", () => {
    let sim = simulate(AND);
    sim = sim.set({ a: 1, b: 1 }).run();
    expect(sim.read("out")).toBe(1);
    sim = sim.set({ a: 0 }).run();
    expect(sim.read("out")).toBe(0);
  });

  it("starts with every signal unknown", () => {
    const start = simulate(AND);
    expect(start.tick).toBe(0);
    expect(start.stable).toBe(false); // the first step still has to evaluate every gate
    expect(start.readAll()).toEqual({ out: "X" });
    expect(Object.values(start.inspect().signals).every((v) => v === "X")).toBe(true);
  });

  it("never changes a state: set, step and run return new ones", () => {
    const start = simulate(AND);
    const assigned = start.set({ a: 1, b: 1 });
    const settled = assigned.run();
    expect(assigned).not.toBe(start);
    expect(settled).not.toBe(assigned);
    expect(start.inspect()).toMatchObject({ tick: 0, pendingEvents: 0 });
    expect(assigned.inspect()).toMatchObject({ tick: 0, pendingEvents: 2 });
    expect(assigned.read("out")).toBe("X");
    expect(settled.read("out")).toBe(1);
    expect(Object.isFrozen(settled)).toBe(true);
    expect(Object.isFrozen(settled.changes)).toBe(true);
  });

  it("returns the same state when set() changes nothing", () => {
    const settled = simulate(AND).set({ a: 0, b: 1 }).run();
    expect(settled.set({ a: 0 })).toBe(settled);
    expect(settled.set({})).toBe(settled);
  });

  it("does not evaluate on read", () => {
    const sim = simulate(NOT).set({ a: 0 });
    expect(sim.read("out")).toBe("X");
    expect(sim.tick).toBe(0);
    expect(sim.run().read("out")).toBe(1);
  });

  it("delays each primitive by one tick", () => {
    const s0 = simulate(AND, { trace: true }).set({ a: 1, b: 1 });
    const s1 = s0.step(); // tick 0: inputs applied, NAND evaluated
    const s2 = s1.step(); // tick 1: NAND output applied, NOT evaluated
    const s3 = s2.step(); // tick 2: NOT output applied
    expect([s1, s2, s3].map((s) => s.read("out"))).toEqual(["X", "X", 1]);
    expect(s1.changes.map((c) => c.wire)).toEqual(["root.inputs.a", "root.inputs.b"]);
    expect(s2.changes).toEqual([{ tick: 1, wire: "root.nand.outputs.out", previous: "X", value: 0 }]);
    expect(s3.changes).toEqual([{ tick: 2, wire: "root.not.g.outputs.out", previous: "X", value: 1 }]);
    expect(s3.inspect()).toMatchObject({ tick: 3, pendingEvents: 0, stable: true });
    expect(s3.run()).toBe(s3);
    expect(s3.trace()).toEqual([...s1.changes, ...s2.changes, ...s3.changes]);
  });

  it("propagates across a chain of gates with one tick per gate", () => {
    const depth = 7;
    const Chain = circuit({ name: "Chain", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
      let previous: SourcePort = inputs.a;
      for (let i = 0; i < depth; i++) previous = add(NOT, `n${i}`, { a: previous }).outputs.out;
      output("out", previous);
    });
    const first = simulate(Chain).set({ a: 0 }).run();
    expect(first.tick).toBe(depth + 1);
    expect(first.read("out")).toBe(1);
    const second = first.set({ a: 1 }).run();
    expect(second.tick - first.tick).toBe(depth + 1);
    expect(second.read("out")).toBe(0);
  });

  it("passes direct input-to-output connections with no delay", () => {
    const sim = simulate(Wire).set({ a: 1 }).step();
    expect(sim.read("out")).toBe(1);
    expect(sim.inspect().signals).toEqual({ "root.inputs.a": 1, "root.outputs.out": 1 });
  });

  it("handles input changes after stabilization", () => {
    let sim = simulate(XOR);
    for (const [a, b, out] of [[0, 0, 0], [0, 1, 1], [1, 1, 0], [1, 0, 1], [0, 0, 0]] as const) {
      sim = sim.set({ a, b }).run();
      expect(sim.read("out")).toBe(out);
    }
  });

  it("applies simultaneous input changes in the same tick", () => {
    const before = simulate(AND).set({ a: 0, b: 0 }).run();
    const after = before.set({ a: 1, b: 1 }).step();
    expect(after.changes).toEqual([
      { tick: 3, wire: "root.inputs.a", previous: 0, value: 1 },
      { tick: 3, wire: "root.inputs.b", previous: 0, value: 1 },
    ]);
    expect(after.run().read("out")).toBe(1);
  });

  it("can be stepped by hand to keep every state", () => {
    const states: SimulationState<"a" | "b", "out">[] = [simulate(AND).set({ a: 1, b: 1 })];
    while (!states.at(-1)!.stable) states.push(states.at(-1)!.step());
    expect(states.map((s) => s.read("out"))).toEqual(["X", "X", "X", 1]);
    expect(states.at(-1)!.inspect()).toEqual(states[0]!.run().inspect());
  });

  it("validates set() and read() arguments", () => {
    const sim = simulate(AND);
    expect(() => sim.set({ c: 1 } as never)).toThrow(new SimulationError('Unknown input "c" (inputs are a, b)'));
    expect(() => sim.set({ a: true } as never)).toThrow(/Invalid signal for input "a": true/);
    expect(() => sim.set({ a: 2 } as never)).toThrow(/Invalid signal for input "a": 2/);
    expect(() => sim.set({ a: 1, b: "x" } as never)).toThrow(/Invalid signal for input "b": "x"/);
    expect(() => sim.read("nope" as never)).toThrow(/Unknown output "nope" \(outputs are out\)/);
    expect(() => simulate(AND, { maxTicks: 0 })).toThrow(/maxTicks must be a positive integer/);
  });

  it("type-checks port names", () => {
    const sim = simulate(AND);
    // @ts-expect-error AND has no input "c"
    expect(() => sim.set({ c: 1 })).toThrow();
    // @ts-expect-error AND has no output "q"
    expect(() => sim.read("q")).toThrow();
    // @ts-expect-error booleans are not signals
    expect(() => sim.set({ a: true })).toThrow();
  });
});

describe("branching and history", () => {
  it("branches experiments from one state", () => {
    const held = simulate(SRLatch).set({ setN: 0, resetN: 1 }).run().set({ setN: 1 }).run();
    const reset = held.set({ resetN: 0 }).run();
    const setAgain = held.set({ setN: 0 }).run();
    expect(held.readAll()).toEqual({ q: 1, qBar: 0 });
    expect(reset.readAll()).toEqual({ q: 0, qBar: 1 });
    expect(setAgain.readAll()).toEqual({ q: 1, qBar: 0 });
  });

  it("keeps a separate trace for each branch", () => {
    const base = simulate(NOT, { trace: true }).set({ a: 0 }).run();
    const high = base.set({ a: 1 }).run();
    const low = base.set({ a: "X" }).run();
    expect(base.trace()).toHaveLength(2);
    expect(high.trace().slice(2).map((t) => t.value)).toEqual([1, 0]);
    expect(low.trace().slice(2).map((t) => t.value)).toEqual(["X", "X"]);
  });

  it("starts over by going back to an earlier state", () => {
    const start = simulate(AND, { trace: true });
    const used = start.set({ a: 1, b: 1 }).run();
    expect(used.read("out")).toBe(1);
    expect(start.readAll()).toEqual({ out: "X" });
    expect(start.trace()).toEqual([]);
  });

  it("returns frozen traces and records nothing by default", () => {
    const traced = simulate(NOT, { trace: true }).set({ a: 1 }).run();
    expect(Object.isFrozen(traced.trace())).toBe(true);
    expect(Object.isFrozen(traced.trace()[0])).toBe(true);
    expect(simulate(NOT).set({ a: 1 }).run().trace()).toEqual([]);
  });

  it("keeps simulations of one definition independent", () => {
    const first = simulate(AND).set({ a: 1, b: 1 }).run();
    const second = simulate(AND).set({ a: 0, b: 1 }).run();
    expect(first.read("out")).toBe(1);
    expect(second.read("out")).toBe(0);
  });

  it("leaves the previous state usable after an evaluator throws", () => {
    const Fragile = gate({
      name: "Fragile",
      inputs: ["a"],
      outputs: ["out"],
      evaluate: ({ a }) => {
        if (a === 0) throw new Error("zero!");
        return { out: a };
      },
    });
    const good = simulate(Fragile).set({ a: 1 }).run();
    expect(() => good.set({ a: 0 }).run()).toThrow(/threw during evaluation: zero!/);
    expect(good.read("out")).toBe(1);
    expect(good.set({ a: "X" }).run().read("out")).toBe("X");
  });
});

describe("events", () => {
  it("does not create events for unchanged values", () => {
    let evaluations = 0;
    const Probe = gate({
      name: "Probe",
      inputs: ["a"],
      outputs: ["out"],
      evaluate: ({ a }) => {
        evaluations++;
        return { out: a };
      },
    });
    const C = circuit({ name: "C", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
      const nand = add(NAND, "nand", { a: inputs.a, b: inputs.b });
      const probe = add(Probe, "probe", { a: nand.outputs.out });
      output("out", probe.outputs.out);
    });
    const settled = simulate(C, { trace: true }).set({ a: 0, b: 0 }).run();
    expect(settled.read("out")).toBe(1);
    const evaluationsAfterSettle = evaluations;

    // NAND output stays 1 when b changes while a = 0: nothing downstream runs.
    const next = settled.set({ b: 1 }).run();
    expect(next.tick - settled.tick).toBe(1);
    expect(evaluations).toBe(evaluationsAfterSettle);
    expect(next.trace().slice(settled.trace().length).map((t) => t.wire)).toEqual(["root.inputs.b"]);
  });

  it("only evaluates gates whose inputs changed", () => {
    const counts = new Map<string, number>();
    const Counted = (name: string) =>
      gate({
        name,
        inputs: ["a"],
        outputs: ["out"],
        evaluate: ({ a }) => {
          counts.set(name, (counts.get(name) ?? 0) + 1);
          return { out: a };
        },
      });
    const L = Counted("L");
    const R = Counted("R");
    const C = circuit({ name: "C", inputs: ["a", "b"], outputs: ["x", "y"] }, ({ inputs, add, output }) => {
      output("x", add(L, "l", { a: inputs.a }).outputs.out);
      output("y", add(R, "r", { a: inputs.b }).outputs.out);
    });
    const first = simulate(C).run(); // first step evaluates every gate
    expect([counts.get("L"), counts.get("R")]).toEqual([1, 1]);
    first.set({ a: 1 }).run();
    expect([counts.get("L"), counts.get("R")]).toEqual([2, 1]);
  });
});

describe("structure in simulation", () => {
  it("supports fan-out", () => {
    const Fan = circuit({ name: "Fan", inputs: ["a"], outputs: ["x", "y", "z"] }, ({ inputs, add, output }) => {
      for (const out of ["x", "y", "z"] as const) output(out, add(NOT, `not_${out}`, { a: inputs.a }).outputs.out);
    });
    expect(simulate(Fan).set({ a: 0 }).run().readAll()).toEqual({ x: 1, y: 1, z: 1 });
    expect(simulate(Fan).set({ a: 1 }).run().readAll()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("keeps instances of the same definition independent", () => {
    const Two = circuit({ name: "Two", inputs: ["a", "b"], outputs: ["x", "y"] }, ({ inputs, add, output }) => {
      output("x", add(NOT, { a: inputs.a }).outputs.out);
      output("y", add(NOT, { a: inputs.b }).outputs.out);
    });
    expect(simulate(Two).set({ a: 0, b: 1 }).run().readAll()).toEqual({ x: 1, y: 0 });
    expect(simulate(Two).set({ a: 1, b: 0 }).run().readAll()).toEqual({ x: 0, y: 1 });
    expect(elaborate(Two).gates.map((g) => g.path)).toEqual(["root.NOT#0.g", "root.NOT#1.g"]);
  });

  it("supports arbitrary nesting depth", () => {
    let def: ComponentDefinition<"a", "out"> = NOT;
    for (let level = 0; level < 12; level++) {
      const inner = def;
      def = circuit({ name: `Level${level}`, inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
        output("out", add(inner, "inner", { a: inputs.a }).outputs.out);
      });
    }
    expect(simulate(def).set({ a: 1 }).run().readAll()).toEqual({ out: 0 });
    const [only] = elaborate(def).gates;
    expect(only!.path).toBe(`root${".inner".repeat(12)}.g`);
    expect(only!.ancestors).toHaveLength(13);
    expect(only!.ancestors[0]).toEqual({ id: "root", definition: "Level11" });
    expect(only!.ancestors[12]).toEqual({ id: `root${".inner".repeat(12)}`, definition: "NOT" });
  });

  it("produces identical results regardless of declaration order", () => {
    const build = (order: "forward" | "reverse") =>
      circuit({ name: "Xor", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, feed, output }) => {
        const names = ["n1", "n2", "n3", "n4"];
        const gates = Object.fromEntries(
          (order === "forward" ? names : [...names].reverse()).map((n) => [n, add(NAND, n)]),
        ) as Record<string, ComponentInstance<"a" | "b", "out">>;
        const wiring: Array<() => void> = [
          () => feed(gates.n1!.inputs.a, inputs.a),
          () => feed(gates.n1!.inputs.b, inputs.b),
          () => feed(gates.n2!.inputs.a, inputs.a),
          () => feed(gates.n2!.inputs.b, gates.n1!.outputs.out),
          () => feed(gates.n3!.inputs.a, inputs.b),
          () => feed(gates.n3!.inputs.b, gates.n1!.outputs.out),
          () => feed(gates.n4!.inputs.a, gates.n2!.outputs.out),
          () => feed(gates.n4!.inputs.b, gates.n3!.outputs.out),
          () => output("out", gates.n4!.outputs.out),
        ];
        for (const w of order === "forward" ? wiring : [...wiring].reverse()) w();
      });
    const runAll = (def: ComponentDefinition<"a" | "b", "out">) => {
      let sim = simulate(def, { trace: true });
      for (const [a, b] of [[0, 0], [1, 1], [0, 1], [1, 0], [1, 1]] as const) sim = sim.set({ a, b }).run();
      const { tick, signals, wires } = sim.inspect();
      const wireValues = Object.fromEntries(Object.entries(wires).map(([id, w]) => [id, w.value]));
      return { trace: sim.trace(), tick, signals, wireValues };
    };
    const forward = runAll(build("forward"));
    const reverse = runAll(build("reverse"));
    // Values and timing match exactly; only presentation order (ports listed per wire) follows declarations.
    expect(reverse).toEqual(forward);
    // The simultaneous 0,0 -> 1,1 change produces the same hazard glitch both ways.
    expect(forward.trace.filter((t) => t.wire === "root.n4.outputs.out").length).toBeGreaterThan(4);
  });

  it("reports wire loops with no gate", () => {
    const Loop = circuit({ name: "Loop", inputs: [], outputs: ["out"] }, ({ add, feed, output }) => {
      const w = add(Wire, "w");
      feed(w.inputs.a, w.outputs.out);
      output("out", w.outputs.out);
    });
    expect(() => simulate(Loop)).toThrow(/^Loop: Wire loop with no driving gate: root\.w\.(inputs\.a|outputs\.out) -> /);
  });
});
