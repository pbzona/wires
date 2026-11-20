import { describe, expect, it } from "vitest";
import { AND, HalfAdder, SRLatch } from "wires/components";
import { elaborate, simulate } from "wires";

describe("topology", () => {
  it("describes nested standard components", () => {
    const d = HalfAdder.describe();
    expect(d.components.map((c) => `${c.id}:${c.definition}:${c.kind}`)).toEqual([
      "root.xor:XOR:composite",
      "root.and:AND:composite",
    ]);
    const and = d.components[1]!;
    expect(and.components.map((c) => c.id)).toEqual(["root.and.nand", "root.and.not"]);
    expect(and.components[1]!.components[0]).toMatchObject({ id: "root.and.not.g", parent: "root.and.not", kind: "primitive" });
  });

  it("describes feedback connections", () => {
    expect(SRLatch.describe().connections).toEqual([
      { source: "root.inputs.setN", destination: "root.top.inputs.a" },
      { source: "root.inputs.resetN", destination: "root.bottom.inputs.a" },
      { source: "root.top.outputs.out", destination: "root.bottom.inputs.b" },
      { source: "root.bottom.outputs.out", destination: "root.top.inputs.b" }, // fed back
      { source: "root.top.outputs.out", destination: "root.outputs.q" },
      { source: "root.bottom.outputs.out", destination: "root.outputs.qBar" },
    ]);
  });

  it("exposes the flattened netlist", () => {
    const netlist = elaborate(AND);
    expect(netlist.gates).toEqual([
      {
        path: "root.nand",
        definition: "NAND",
        ancestors: [{ id: "root", definition: "AND" }],
        inputs: { a: "root.inputs.a", b: "root.inputs.b" },
        outputs: { out: "root.nand.outputs.out" },
      },
      {
        path: "root.not.g",
        definition: "NAND",
        ancestors: [
          { id: "root", definition: "AND" },
          { id: "root.not", definition: "NOT" },
        ],
        inputs: { a: "root.nand.outputs.out", b: "root.nand.outputs.out" },
        outputs: { out: "root.not.g.outputs.out" },
      },
    ]);
    expect(netlist.nets.find((n) => n.id === "root.nand.outputs.out")).toEqual({
      id: "root.nand.outputs.out",
      driver: "gate",
      gate: "root.nand",
      ports: ["root.nand.outputs.out", "root.not.inputs.a", "root.not.g.inputs.a", "root.not.g.inputs.b"],
      readers: ["root.not.g"],
    });
    expect(netlist.outputs).toEqual({ out: "root.not.g.outputs.out" });
    expect(netlist.portNets["root.outputs.out"]).toBe("root.not.g.outputs.out");
    expect(JSON.parse(JSON.stringify(netlist))).toEqual(netlist);
    expect(Object.isFrozen(netlist.nets[0])).toBe(true);
  });
});

describe("state inspection", () => {
  it("matches the specification example", () => {
    const sim = simulate(AND);
    sim.set({ a: 1, b: 1 });
    sim.run();
    const snapshot = sim.inspect();
    expect(snapshot).toMatchObject({
      tick: 3,
      signals: {
        "root.inputs.a": 1,
        "root.inputs.b": 1,
        "root.nand.outputs.out": 0,
        "root.not.g.outputs.out": 1,
        "root.outputs.out": 1,
      },
      pendingEvents: 0,
      stable: true,
    });
    // Every port in the hierarchy has a value, so a frontend can color any wire.
    expect(Object.keys(snapshot.signals)).toEqual(elaborate(AND).ports);
    expect(snapshot.signals["root.not.inputs.a"]).toBe(0);
  });

  it("shows pending events mid-propagation", () => {
    const sim = simulate(AND);
    sim.set({ a: 1, b: 1 });
    expect(sim.inspect()).toMatchObject({ tick: 0, pendingEvents: 2, stable: false });
    sim.tick();
    expect(sim.inspect()).toMatchObject({ tick: 1, pendingEvents: 1, stable: false });
  });

  it("returns independent snapshots", () => {
    const sim = simulate(AND);
    const before = sim.inspect();
    sim.set({ a: 0 });
    sim.run();
    expect(before.signals["root.outputs.out"]).toBe("X");
    expect(sim.inspect().signals["root.outputs.out"]).toBe(0);
  });
});

describe("tracing", () => {
  it("records ordered transitions with timestamps", () => {
    const sim = simulate(SRLatch, { trace: true });
    sim.set({ setN: 0, resetN: 1 });
    sim.run();
    sim.set({ setN: 1 });
    sim.run();
    const trace = sim.trace();
    expect(trace).toEqual([
      { tick: 0, signalId: "root.inputs.resetN", previous: "X", value: 1 },
      { tick: 0, signalId: "root.inputs.setN", previous: "X", value: 0 },
      { tick: 1, signalId: "root.top.outputs.out", previous: "X", value: 1 },
      { tick: 2, signalId: "root.bottom.outputs.out", previous: "X", value: 0 },
      { tick: 3, signalId: "root.inputs.setN", previous: 0, value: 1 },
    ]);
    const ticks = trace.map((t) => t.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("is deterministic across simulators", () => {
    const record = () => {
      const sim = simulate(HalfAdder, { trace: true });
      sim.set({ a: 1, b: 0 });
      sim.run();
      sim.set({ a: 1, b: 1 });
      sim.run();
      return sim.trace();
    };
    expect(record()).toEqual(record());
  });
});
