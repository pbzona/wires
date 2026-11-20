import { describe, expect, it } from "vitest";
import { AND, NAND, NOT, XOR } from "wires/components";
import {
  type ComponentDefinition,
  type ComponentInstance,
  SimulationError,
  type SourcePort,
  circuit,
  elaborate,
  gate,
  simulate,
} from "wires";

const Wire = circuit({ name: "Wire", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, connect }) => {
  connect(inputs.a, outputs.out);
});

describe("simulator basics", () => {
  it("matches the README example", () => {
    const sim = simulate(AND);
    sim.set({ a: 1, b: 1 });
    sim.run();
    expect(sim.read("out")).toBe(1);
    sim.set({ a: 0 });
    sim.run();
    expect(sim.read("out")).toBe(0);
  });

  it("starts with every signal unknown", () => {
    const sim = simulate(AND);
    expect(sim.readAll()).toEqual({ out: "X" });
    expect(Object.values(sim.inspect().signals).every((v) => v === "X")).toBe(true);
  });

  it("does not evaluate on read", () => {
    const sim = simulate(NOT);
    sim.set({ a: 0 });
    expect(sim.read("out")).toBe("X");
    expect(sim.inspect().tick).toBe(0);
    sim.run();
    expect(sim.read("out")).toBe(1);
  });

  it("delays each primitive by one tick", () => {
    const sim = simulate(AND, { trace: true });
    sim.set({ a: 1, b: 1 });
    sim.tick(); // tick 0: inputs applied, NAND evaluated
    expect(sim.read("out")).toBe("X");
    sim.tick(); // tick 1: NAND output applied, NOT evaluated
    expect(sim.read("out")).toBe("X");
    sim.tick(); // tick 2: NOT output applied
    expect(sim.read("out")).toBe(1);
    expect(sim.inspect()).toMatchObject({ tick: 3, pendingEvents: 0, stable: true });
    expect(sim.run()).toEqual({ ticks: 0, tick: 3 });
    expect(sim.trace()).toEqual([
      { tick: 0, signalId: "root.inputs.a", previous: "X", value: 1 },
      { tick: 0, signalId: "root.inputs.b", previous: "X", value: 1 },
      { tick: 1, signalId: "root.nand.outputs.out", previous: "X", value: 0 },
      { tick: 2, signalId: "root.not.g.outputs.out", previous: "X", value: 1 },
    ]);
  });

  it("propagates across a chain of gates with one tick per gate", () => {
    const depth = 7;
    const Chain = circuit({ name: "Chain", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
      let previous: SourcePort = inputs.a;
      for (let i = 0; i < depth; i++) {
        const not = add(NOT, `n${i}`);
        connect(previous, not.inputs.a);
        previous = not.outputs.out;
      }
      connect(previous, outputs.out);
    });
    const sim = simulate(Chain);
    sim.set({ a: 0 });
    expect(sim.run()).toEqual({ ticks: depth + 1, tick: depth + 1 });
    expect(sim.read("out")).toBe(1);
    sim.set({ a: 1 });
    expect(sim.run()).toEqual({ ticks: depth + 1, tick: 2 * (depth + 1) });
    expect(sim.read("out")).toBe(0);
  });

  it("passes direct input-to-output connections with no delay", () => {
    const sim = simulate(Wire);
    sim.set({ a: 1 });
    sim.tick();
    expect(sim.read("out")).toBe(1);
    expect(sim.inspect().signals).toEqual({ "root.inputs.a": 1, "root.outputs.out": 1 });
  });

  it("handles input changes after stabilization", () => {
    const sim = simulate(XOR);
    const seq: Array<[0 | 1, 0 | 1, 0 | 1]> = [
      [0, 0, 0],
      [0, 1, 1],
      [1, 1, 0],
      [1, 0, 1],
      [0, 0, 0],
    ];
    for (const [a, b, out] of seq) {
      sim.set({ a, b });
      sim.run();
      expect(sim.read("out")).toBe(out);
    }
  });

  it("applies simultaneous input changes in the same tick", () => {
    const sim = simulate(AND, { trace: true });
    sim.set({ a: 0, b: 0 });
    sim.run();
    const before = sim.trace().length;
    sim.set({ a: 1, b: 1 });
    sim.run();
    const changes = sim.trace().slice(before);
    expect(changes.slice(0, 2)).toEqual([
      { tick: 3, signalId: "root.inputs.a", previous: 0, value: 1 },
      { tick: 3, signalId: "root.inputs.b", previous: 0, value: 1 },
    ]);
    expect(sim.read("out")).toBe(1);
  });

  it("validates set() and read() arguments", () => {
    const sim = simulate(AND);
    expect(() => sim.set({ c: 1 } as never)).toThrow(new SimulationError('Unknown input "c" (inputs are a, b)'));
    expect(() => sim.set({ a: true } as never)).toThrow(/Invalid signal for input "a": true/);
    expect(() => sim.set({ a: 2 } as never)).toThrow(/Invalid signal for input "a": 2/);
    expect(() => sim.set({ a: 1, b: "x" } as never)).toThrow(/Invalid signal for input "b": "x"/);
    // A rejected set() changes nothing.
    expect(sim.inspect().pendingEvents).toBe(0);
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
    const C = circuit({ name: "C", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
      const nand = add(NAND, "nand");
      const probe = add(Probe, "probe");
      connect(inputs.a, nand.inputs.a);
      connect(inputs.b, nand.inputs.b);
      connect(nand.outputs.out, probe.inputs.a);
      connect(probe.outputs.out, outputs.out);
    });
    const sim = simulate(C, { trace: true });
    sim.set({ a: 0, b: 0 });
    sim.run();
    expect(sim.read("out")).toBe(1);
    const evaluationsAfterSettle = evaluations;
    const traceAfterSettle = sim.trace().length;

    // NAND output stays 1 when b changes while a = 0: nothing downstream runs.
    sim.set({ b: 1 });
    expect(sim.run().ticks).toBe(1);
    expect(evaluations).toBe(evaluationsAfterSettle);
    expect(sim.trace().slice(traceAfterSettle).map((t) => t.signalId)).toEqual(["root.inputs.b"]);

    // Re-setting an input to its current value schedules nothing at all.
    sim.set({ a: 0, b: 1 });
    expect(sim.inspect().pendingEvents).toBe(0);
    expect(sim.run().ticks).toBe(0);
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
    const C = circuit({ name: "C", inputs: ["a", "b"], outputs: ["x", "y"] }, ({ inputs, outputs, add, connect }) => {
      const l = add(L, "l");
      const r = add(R, "r");
      connect(inputs.a, l.inputs.a);
      connect(inputs.b, r.inputs.a);
      connect(l.outputs.out, outputs.x);
      connect(r.outputs.out, outputs.y);
    });
    const sim = simulate(C);
    sim.run(); // initial evaluation of every gate
    expect([counts.get("L"), counts.get("R")]).toEqual([1, 1]);
    sim.set({ a: 1 });
    sim.run();
    expect([counts.get("L"), counts.get("R")]).toEqual([2, 1]);
  });
});

describe("structure in simulation", () => {
  it("supports fan-out", () => {
    const Fan = circuit({ name: "Fan", inputs: ["a"], outputs: ["x", "y", "z"] }, ({ inputs, outputs, add, connect }) => {
      for (const out of ["x", "y", "z"] as const) {
        const not = add(NOT, `not_${out}`);
        connect(inputs.a, not.inputs.a);
        connect(not.outputs.out, outputs[out]);
      }
    });
    expect(simulateTo(Fan, { a: 0 })).toEqual({ x: 1, y: 1, z: 1 });
    expect(simulateTo(Fan, { a: 1 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("keeps instances of the same definition independent", () => {
    const Two = circuit({ name: "Two", inputs: ["a", "b"], outputs: ["x", "y"] }, ({ inputs, outputs, add, connect }) => {
      const first = add(NOT);
      const second = add(NOT);
      connect(inputs.a, first.inputs.a);
      connect(inputs.b, second.inputs.a);
      connect(first.outputs.out, outputs.x);
      connect(second.outputs.out, outputs.y);
    });
    expect(simulateTo(Two, { a: 0, b: 1 })).toEqual({ x: 1, y: 0 });
    expect(simulateTo(Two, { a: 1, b: 0 })).toEqual({ x: 0, y: 1 });
    expect(elaborate(Two).gates.map((g) => g.path)).toEqual(["root.NOT#0.g", "root.NOT#1.g"]);
  });

  it("supports arbitrary nesting depth", () => {
    let def: ComponentDefinition<"a", "out"> = NOT;
    for (let level = 0; level < 12; level++) {
      const inner = def;
      def = circuit({ name: `Level${level}`, inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
        const c = add(inner, "inner");
        connect(inputs.a, c.inputs.a);
        connect(c.outputs.out, outputs.out);
      });
    }
    expect(simulateTo(def, { a: 1 })).toEqual({ out: 0 });
    const [only] = elaborate(def).gates;
    expect(only!.path).toBe(`root${".inner".repeat(12)}.g`);
    expect(only!.ancestors).toHaveLength(13);
    expect(only!.ancestors[0]).toEqual({ id: "root", definition: "Level11" });
    expect(only!.ancestors[12]).toEqual({ id: `root${".inner".repeat(12)}`, definition: "NOT" });
  });

  it("produces identical results regardless of declaration order", () => {
    const build = (order: "forward" | "reverse") =>
      circuit({ name: "Xor", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
        const names = ["n1", "n2", "n3", "n4"];
        const gates = Object.fromEntries(
          (order === "forward" ? names : [...names].reverse()).map((n) => [n, add(NAND, n)]),
        ) as Record<string, ComponentInstance<"a" | "b", "out">>;
        const wiring: Array<() => void> = [
          () => connect(inputs.a, gates.n1!.inputs.a),
          () => connect(inputs.b, gates.n1!.inputs.b),
          () => connect(inputs.a, gates.n2!.inputs.a),
          () => connect(gates.n1!.outputs.out, gates.n2!.inputs.b),
          () => connect(inputs.b, gates.n3!.inputs.a),
          () => connect(gates.n1!.outputs.out, gates.n3!.inputs.b),
          () => connect(gates.n2!.outputs.out, gates.n4!.inputs.a),
          () => connect(gates.n3!.outputs.out, gates.n4!.inputs.b),
          () => connect(gates.n4!.outputs.out, outputs.out),
        ];
        for (const w of order === "forward" ? wiring : [...wiring].reverse()) w();
      });
    const runAll = (def: ComponentDefinition<"a" | "b", "out">) => {
      const sim = simulate(def, { trace: true });
      for (const [a, b] of [[0, 0], [1, 1], [0, 1], [1, 0], [1, 1]] as const) {
        sim.set({ a, b });
        sim.run();
      }
      return { trace: sim.trace(), state: sim.inspect() };
    };
    const forward = runAll(build("forward"));
    const reverse = runAll(build("reverse"));
    expect(reverse.trace).toEqual(forward.trace);
    expect(reverse.state).toEqual(forward.state);
    // The simultaneous 0,0 -> 1,1 change produces the same hazard glitch both ways.
    expect(forward.trace.filter((t) => t.signalId === "root.n4.outputs.out").length).toBeGreaterThan(4);
  });

  it("reports wire loops with no gate", () => {
    const Loop = circuit({ name: "Loop", inputs: [], outputs: ["out"] }, ({ outputs, add, connect }) => {
      const w = add(Wire, "w");
      connect(w.outputs.out, w.inputs.a);
      connect(w.outputs.out, outputs.out);
    });
    expect(() => simulate(Loop)).toThrow(/^Loop: Wire loop with no driving gate: root\.w\.(inputs\.a|outputs\.out) -> /);
  });
});

describe("simulator lifecycle", () => {
  it("resets to the initial state", () => {
    const sim = simulate(AND, { trace: true });
    sim.set({ a: 1, b: 1 });
    sim.run();
    expect(sim.read("out")).toBe(1);
    sim.reset();
    expect(sim.inspect()).toMatchObject({ tick: 0, pendingEvents: 0, stable: false });
    expect(sim.readAll()).toEqual({ out: "X" });
    expect(sim.trace()).toEqual([]);
    sim.run();
    expect(sim.read("out")).toBe("X"); // inputs were cleared too
    sim.set({ a: 1, b: 1 });
    sim.run();
    expect(sim.read("out")).toBe(1);
    // The empty run after reset() processed tick 0, so the new inputs land on tick 1.
    expect(sim.trace()[0]).toEqual({ tick: 1, signalId: "root.inputs.a", previous: "X", value: 1 });
  });

  it("keeps simulators of one definition independent", () => {
    const first = simulate(AND);
    const second = simulate(AND);
    first.set({ a: 1, b: 1 });
    first.run();
    second.set({ a: 0, b: 1 });
    second.run();
    expect(first.read("out")).toBe(1);
    expect(second.read("out")).toBe(0);
    first.reset();
    expect(second.read("out")).toBe(0);
  });

  it("returns copies of the trace", () => {
    const sim = simulate(NOT, { trace: true });
    sim.set({ a: 1 });
    sim.run();
    const trace = sim.trace();
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace[0])).toBe(true);
    sim.set({ a: 0 });
    sim.run();
    expect(trace).toHaveLength(2);
    expect(sim.trace()).toHaveLength(4);
  });

  it("does not record a trace by default", () => {
    const sim = simulate(NOT);
    sim.set({ a: 1 });
    sim.run();
    expect(sim.trace()).toEqual([]);
  });
});

function simulateTo<I extends string, O extends string>(
  def: ComponentDefinition<I, O>,
  inputs: { [K in I]?: 0 | 1 },
) {
  const sim = simulate(def);
  sim.set(inputs);
  sim.run();
  return sim.readAll();
}
