import { describe, expect, expectTypeOf, it } from "vitest";
import {
  bits, circuit, CircuitError, gate, simulate,
  type CircuitBuilder, type ComponentInstance, type InputWiring, type SinkPort, type SourcePort,
} from "@pbzona/wires";

function byteSpec(name: string) {
  return { name, inputs: [bits("d", 8), "flag"], outputs: [bits("q", 8), "ready"] } as const;
}

function byteWire() {
  return circuit(byteSpec("ByteWire"), ({ inputs, output }) => {
    output("q", inputs.d);
    output("ready", inputs.flag);
  });
}

describe("named port groups", () => {
  it("exposes readonly arrays of ordinary ports and connects whole groups in index order", () => {
    const Byte = byteWire();
    const Pair = circuit(byteSpec("Pair"), ({ inputs, add, output }) => {
      const first = add(Byte, "first", { d: inputs.d, flag: inputs.flag });
      const next = add(Byte, { d: first.outputs.q, flag: first.outputs.ready });
      expectTypeOf(inputs.d).toExtend<readonly SourcePort[]>();
      expectTypeOf(first.inputs.d).toExtend<readonly SinkPort[]>();
      expectTypeOf(first.outputs.q).toExtend<readonly SourcePort[]>();
      expectTypeOf(inputs.d).not.toExtend<SourcePort[]>();
      expectTypeOf(first.inputs.d).not.toExtend<SinkPort[]>();
      expectTypeOf(first.outputs.q).not.toExtend<SourcePort[]>();
      for (const group of [inputs.d, first.inputs.d, first.outputs.q]) {
        expect(Array.isArray(group)).toBe(true);
        expect(Object.isFrozen(group)).toBe(true);
      }
      expect(inputs.d[3]).toBe(inputs.d3);
      expect(first.inputs.d[3]).toBe(first.inputs.d3);
      expect(first.outputs.q[3]).toBe(first.outputs.q3);
      output("q", next.outputs.q);
      output("ready", next.outputs.ready);
    });

    expect(Pair.inputs).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "flag"]);
    expect(Pair.outputs).toEqual(["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7", "ready"]);
    expect(Pair.inputGroups).toEqual({ d: Pair.inputs.slice(0, 8) });
    expect(Pair.outputGroups).toEqual({ q: Pair.outputs.slice(0, 8) });
    for (const names of [Pair.inputs, Pair.outputs, Pair.inputGroups, Pair.outputGroups, Pair.inputGroups.d, Pair.outputGroups.q]) {
      expect(Object.isFrozen(names)).toBe(true);
    }
    const topology = Pair.describe();
    expect(topology.ports.map(p => p.name)).toEqual([...Pair.inputs, ...Pair.outputs]);
    const nextId = topology.components[1]!.id;
    for (let i = 0; i < 8; i++) {
      expect(topology.connections).toContainEqual({ source: `root.inputs.d${i}`, destination: `root.first.inputs.d${i}` });
      expect(topology.connections).toContainEqual({ source: `root.first.outputs.q${i}`, destination: `${nextId}.inputs.d${i}` });
      expect(topology.connections).toContainEqual({ source: `${nextId}.outputs.q${i}`, destination: `root.outputs.q${i}` });
    }
    const sim = simulate(Pair).set({ d0: 1, d3: 0, d7: 1, flag: 0 }).run();
    expect(sim.read("q7")).toBe(1);
    expect(sim.readAll()).toEqual({ q0: 1, q1: "X", q2: "X", q3: 0, q4: "X", q5: "X", q6: "X", q7: 1, ready: 0 });
  });

  it("mixes flat scalar wiring with a late feed to one indexed child input", () => {
    const Pair = circuit({ name: "Pair", inputs: [bits("d", 2)], outputs: [bits("q", 2)] }, ({ inputs, output }) => {
      output("q0", inputs.d1!);
      output("q1", inputs.d0!);
    });
    const Wrapper = circuit({ name: "Wrapper", inputs: ["a", "b"], outputs: ["x", "y"] }, ({ inputs, add, feed, output }) => {
      const pair = add(Pair, { d0: inputs.a });
      feed(pair.inputs.d[1]!, inputs.b);
      output("x", pair.outputs.q0!);
      output("y", pair.outputs.q[1]!);
    });
    expect(simulate(Wrapper).set({ a: 1, b: 0 }).run().readAll()).toEqual({ x: 0, y: 1 });
  });

  it("keeps the existing scalar-only type annotations", () => {
    type Builder = CircuitBuilder<"a", "out">;
    type Child = ComponentInstance<"a", "out">;
    expectTypeOf<Builder["inputs"]["a"]>().toExtend<SourcePort>();
    expectTypeOf<Child["inputs"]["a"]>().toExtend<SinkPort>();
    expectTypeOf<Child["outputs"]["out"]>().toExtend<SourcePort>();
    expectTypeOf<InputWiring<"a">["a"]>().toExtend<SourcePort | undefined>();
    circuit({ name: "Scalar", inputs: ["a"], outputs: ["out"] }, ({ inputs, output }: Builder) => {
      // @ts-expect-error the scalar annotation has no grouped outputs
      expect(() => output("out", [inputs.a])).toThrow(CircuitError);
      output("out", inputs.a);
    });
  });

  it("keeps gate() scalar-only on both sides", () => {
    const d = bits("d", 8);
    expect(Object.isFrozen(d)).toBe(true);
    // @ts-expect-error only circuit() accepts a group declaration
    expect(() => gate({ name: "G", inputs: [d], outputs: [], evaluate: () => ({}) })).toThrow(CircuitError);
    // @ts-expect-error gate outputs must also be strings
    expect(() => gate({ name: "G", inputs: [], outputs: [d], evaluate: () => ({}) })).toThrow(CircuitError);
  });

  it("rejects invalid group names and widths", () => {
    for (const name of ["", "2d", "d.bit", "__proto__"]) {
      expect(() => circuit({ name: "Bad", inputs: [bits(name, 2)], outputs: [] }, () => {}), name).toThrow(CircuitError);
    }
    for (const width of [0, -1, 1.5, NaN]) {
      expect(() => circuit({ name: "Bad", inputs: [bits("d", width)], outputs: [] }, () => {}), String(width)).toThrow(CircuitError);
    }
  });

  it("rejects collisions between group names, expanded pins and scalars, including across directions", () => {
    const d = bits("d", 8);
    for (const [inputs, outputs] of [
      [[d, d], []], [["d", d], []], [[d, "d7"], []], [["d0", d], []],
      [[d], [d]], [[d], ["d"]], [["d"], [d]], [[d], ["d7"]], [["d7"], [d]],
      [[d], [bits("d0", 2)]],
    ] as const) {
      expect(() => circuit({ name: "Clash", inputs, outputs }, () => {
        expect.unreachable("duplicate names must be rejected before wiring");
      })).toThrow(CircuitError);
    }
  });

  it("rejects wrong scalar/group shapes, unknown keys, and feeding a whole group", () => {
    const Byte = byteWire();
    circuit(byteSpec("Check"), ({ inputs, add, feed, output }) => {
      // @ts-expect-error a grouped input takes an array
      expect(() => add(Byte, { d: inputs.flag })).toThrow(CircuitError);
      // @ts-expect-error a scalar input takes one source
      expect(() => add(Byte, "badFlag", { flag: inputs.d })).toThrow(CircuitError);
      // @ts-expect-error no such input on Byte
      expect(() => add(Byte, { missing: inputs.flag })).toThrow(CircuitError);
      // @ts-expect-error a grouped output takes an array
      expect(() => output("q", inputs.flag)).toThrow(CircuitError);
      // @ts-expect-error a scalar output takes one source
      expect(() => output("ready", inputs.d)).toThrow(CircuitError);
      // @ts-expect-error no such output on Check
      expect(() => output("missing", inputs.d)).toThrow(CircuitError);
      const child = add(Byte, { flag: inputs.flag });
      // @ts-expect-error feed remains a one-bit operation
      expect(() => feed(child.inputs.d, inputs.d)).toThrow(CircuitError);
      inputs.d.forEach((source, i) => feed(child.inputs.d[i]!, source));
      output("q", child.outputs.q);
      output("ready", child.outputs.ready);
    });
  });

  it.each(["add", "output"] as const)("%s rejects short, long and sparse source arrays", (operation) => {
    const Byte = byteWire();
    for (const problem of ["short", "long", "sparse"]) {
      expect(() => circuit(byteSpec("Check"), ({ inputs, add, output }) => {
        const sources: SourcePort[] = [...inputs.d];
        if (problem === "short") sources.pop();
        if (problem === "long") sources.push(inputs.flag);
        if (problem === "sparse") delete sources[3]; // length is still eight
        if (operation === "add") add(Byte, { d: sources });
        else output("q", sources);
        expect.unreachable(`accepted a ${problem} array`); // don't pass on a later unconnected-pin error
      }), problem).toThrow(CircuitError);
    }
  });

  it("checks source roles and scope for each bit and only feeds sinks", () => {
    const Byte = byteWire();
    let foreign: SourcePort;
    circuit({ name: "Other", inputs: ["a"], outputs: [] }, ({ inputs }) => { foreign = inputs.a; });
    circuit(byteSpec("Check"), ({ inputs, add, feed, output }) => {
      const child = add(Byte, { d: inputs.d, flag: inputs.flag });
      // @ts-expect-error child outputs aren't sinks, even when indexed
      expect(() => feed(child.outputs.q[1]!, inputs.flag)).toThrow(CircuitError);
      // @ts-expect-error a child input cannot drive a bit of another child
      expect(() => add(Byte, { d: [...inputs.d.slice(0, 7), child.inputs.d[7]!] })).toThrow(CircuitError);
      // Put the foreign port first so a rejected call needn't roll back any connections.
      expect(() => output("q", [foreign!, ...inputs.d.slice(1)])).toThrow(CircuitError);
      output("q", child.outputs.q);
      output("ready", child.outputs.ready);
    });
  });

  it("enforces a single driver across grouped, indexed and flat wiring", () => {
    const Byte = byteWire();
    circuit(byteSpec("Check"), ({ inputs, add, feed, output }) => {
      expect(() => add(Byte, { d: inputs.d, d6: inputs.flag })).toThrow(/multiple drivers/i);
      const child = add(Byte, { d: inputs.d, flag: inputs.flag });
      expect(() => feed(child.inputs.d[6]!, inputs.flag)).toThrow(/multiple drivers/i);
      output("q", child.outputs.q);
      expect(() => output("q6", inputs.flag)).toThrow(/multiple drivers/i);
      output("ready", child.outputs.ready);
    });
  });
});
