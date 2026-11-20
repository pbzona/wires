import { describe, expect, it } from "vitest";
import { AND, NAND, NOT } from "wires/components";
import {
  CircuitError,
  circuit,
  gate,
  type ComponentDefinition,
  type ComponentInstance,
  type SourcePort,
} from "wires";

const BUF = gate({ name: "BUF", inputs: ["a"], outputs: ["out"], evaluate: ({ a }) => ({ out: a }) });

describe("definitions", () => {
  it("exposes the same interface for primitive and composite definitions", () => {
    for (const def of [NAND, NOT, AND] as ComponentDefinition[]) {
      expect(typeof def.name).toBe("string");
      expect(Array.isArray(def.inputs)).toBe(true);
      expect(Array.isArray(def.outputs)).toBe(true);
      expect(typeof def.describe).toBe("function");
    }
    expect(NAND.kind).toBe("primitive");
    expect(AND.kind).toBe("composite");
    expect(AND.inputs).toEqual(["a", "b"]);
    expect(AND.outputs).toEqual(["out"]);
  });

  it("produces immutable definitions", () => {
    expect(Object.isFrozen(NAND)).toBe(true);
    expect(Object.isFrozen(AND)).toBe(true);
    expect(Object.isFrozen(AND.inputs)).toBe(true);
  });

  it("describes topology with stable hierarchical ids", () => {
    const d = AND.describe();
    expect(d).toMatchObject({ id: "root", name: "root", parent: null, definition: "AND", kind: "composite" });
    expect(d.ports).toEqual([
      { id: "root.inputs.a", name: "a", direction: "input" },
      { id: "root.inputs.b", name: "b", direction: "input" },
      { id: "root.outputs.out", name: "out", direction: "output" },
    ]);
    expect(d.components.map((c) => [c.id, c.definition, c.kind, c.parent])).toEqual([
      ["root.nand", "NAND", "primitive", "root"],
      ["root.not", "NOT", "composite", "root"],
    ]);
    const not = d.components[1]!;
    expect(not.components.map((c) => c.id)).toEqual(["root.not.g"]);
    expect(not.connections).toContainEqual({ source: "root.not.inputs.a", destination: "root.not.g.inputs.b" });
    expect(d.connections).toEqual([
      { source: "root.inputs.a", destination: "root.nand.inputs.a" },
      { source: "root.inputs.b", destination: "root.nand.inputs.b" },
      { source: "root.nand.outputs.out", destination: "root.not.inputs.a" },
      { source: "root.not.outputs.out", destination: "root.outputs.out" },
    ]);
    // Serializable and stable across calls.
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(AND.describe()).toEqual(d);
  });

  it("describes a primitive", () => {
    expect(NAND.describe()).toEqual({
      id: "root",
      name: "root",
      parent: null,
      definition: "NAND",
      kind: "primitive",
      ports: [
        { id: "root.inputs.a", name: "a", direction: "input" },
        { id: "root.inputs.b", name: "b", direction: "input" },
        { id: "root.outputs.out", name: "out", direction: "output" },
      ],
      components: [],
      connections: [],
    });
  });

  it("generates deterministic names for unnamed instances", () => {
    const make = () =>
      circuit({ name: "Pair", inputs: ["a"], outputs: ["x", "y"] }, ({ inputs, outputs, add, connect }) => {
        const first = add(NOT);
        const second = add(NOT);
        const named = add(NAND, "n");
        expect([first.name, second.name, named.name]).toEqual(["NOT#0", "NOT#1", "n"]);
        connect(inputs.a, first.inputs.a);
        connect(inputs.a, second.inputs.a);
        connect(inputs.a, named.inputs.a);
        connect(inputs.a, named.inputs.b);
        connect(first.outputs.out, outputs.x);
        connect(second.outputs.out, outputs.y);
      });
    expect(make().describe()).toEqual(make().describe());
    expect(make().describe().components.map((c) => c.id)).toEqual(["root.NOT#0", "root.NOT#1", "root.n"]);
  });

  it("builds lazily and only once", () => {
    let runs = 0;
    const C = circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, connect }) => {
      runs++;
      connect(inputs.a, outputs.out);
    });
    expect(runs).toBe(0);
    C.describe();
    C.describe();
    expect(runs).toBe(1);
  });
});

describe("validation", () => {
  const expectCircuitError = (fn: () => unknown, message: RegExp) => {
    let error: unknown;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CircuitError);
    expect((error as Error).message).toMatch(message);
  };

  it("rejects duplicate port names", () => {
    expectCircuitError(
      () => gate({ name: "G", inputs: ["a", "a"], outputs: ["out"], evaluate: () => ({ out: 0 }) }),
      /^G: Duplicate port name "a"/,
    );
    expectCircuitError(
      () => circuit({ name: "C", inputs: ["a"], outputs: ["a"] }, () => {}),
      /^C: Duplicate port name "a"/,
    );
  });

  it("rejects invalid names", () => {
    expectCircuitError(
      () => gate({ name: "bad name", inputs: [], outputs: [], evaluate: () => ({}) }),
      /Invalid gate name/,
    );
    expectCircuitError(
      () => gate({ name: "G", inputs: ["a.b"], outputs: [], evaluate: () => ({}) }),
      /Invalid input port name "a.b"/,
    );
    expectCircuitError(() => gate({ name: "G", inputs: [], outputs: [], evaluate: 1 as never }), /evaluate must be/);
  });

  it("rejects duplicate and reserved instance names", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: [], outputs: [] }, ({ add }) => {
          add(BUF, "x");
          add(BUF, "x");
        }).describe(),
      /^C: Duplicate component instance name "x"/,
    );
    expectCircuitError(
      () => circuit({ name: "C", inputs: [], outputs: [] }, ({ add }) => void add(BUF, "inputs")).describe(),
      /reserved name/,
    );
  });

  it("rejects connections in the wrong direction", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
          const b = add(BUF, "b");
          // @ts-expect-error a child input is not a source
          connect(b.inputs.a, outputs.out);
          connect(inputs.a, b.inputs.a);
        }).describe(),
      /^C: inputs\.a cannot be a connection source|b\.inputs\.a cannot be a connection source/,
    );
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, connect }) => {
          // @ts-expect-error a circuit's own input is not a destination
          connect(inputs.a, inputs.a);
        }).describe(),
      /inputs\.a cannot be a connection destination/,
    );
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ outputs, add, connect }) => {
          const b = add(BUF, "b");
          // @ts-expect-error a child output is not a destination
          connect(outputs.out, b.outputs.out);
        }).describe(),
      /cannot be a connection/,
    );
  });

  it("rejects multiple drivers for one destination", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, outputs, connect }) => {
          connect(inputs.a, outputs.out);
          connect(inputs.b, outputs.out);
        }).describe(),
      /outputs\.out has multiple drivers \(inputs\.a and inputs\.b\)/,
    );
  });

  it("allows fan-out from one source", () => {
    const Fan = circuit({ name: "Fan", inputs: ["a"], outputs: ["x", "y"] }, ({ inputs, outputs, connect }) => {
      connect(inputs.a, outputs.x);
      connect(inputs.a, outputs.y);
    });
    expect(Fan.describe().connections).toHaveLength(2);
  });

  it("reports unconnected internal inputs and undriven outputs", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out", "other"] }, ({ inputs, outputs, add, connect }) => {
          const n = add(NAND, "n");
          connect(inputs.a, n.inputs.a);
          connect(n.outputs.out, outputs.out);
        }).describe(),
      /input n\.inputs\.b is not connected[\s\S]*output outputs\.other is not driven/,
    );
  });

  it("rejects ports of foreign component instances", () => {
    let stolen: SourcePort | undefined;
    circuit({ name: "Other", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, connect }) => {
      stolen = inputs.a;
      connect(inputs.a, outputs.out);
    }).describe();
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ outputs, connect }) => {
          connect(stolen!, outputs.out);
        }).describe(),
      /belongs to circuit "Other", which is not part of this circuit/,
    );

    let otherInstance: ComponentInstance<"a", "out"> | undefined;
    circuit({ name: "Other2", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
      const b = add(BUF, "b");
      otherInstance = b;
      connect(inputs.a, b.inputs.a);
      connect(b.outputs.out, outputs.out);
    }).describe();
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: [], outputs: ["out"] }, ({ outputs, connect }) => {
          connect(otherInstance!.outputs.out, outputs.out);
        }).describe(),
      /belongs to instance "b"/,
    );
  });

  it("rejects references to ports that do not exist", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
          const n = add(NAND, "n");
          // @ts-expect-error NAND has no input "c"
          connect(inputs.a, n.inputs.c);
          connect(n.outputs.out, outputs.out);
        }).describe(),
      /connect\(\) destination is not a port \(got undefined\)/,
    );
  });

  it("rejects things that are not definitions", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: [], outputs: [] }, ({ add }) => {
          add({ kind: "primitive", name: "Fake", inputs: [], outputs: [], describe: () => ({}) } as never);
        }).describe(),
      /add\(\) expects a component definition/,
    );
  });

  it("rejects use of the builder after it finished", () => {
    let saved: { add: (d: typeof BUF) => unknown } | undefined;
    const C = circuit({ name: "C", inputs: [], outputs: [] }, (b) => {
      saved = b;
    });
    C.describe();
    expectCircuitError(() => saved!.add(BUF), /after the circuit builder finished/);
  });

  it("rejects recursive definitions", () => {
    const Self: ComponentDefinition<"a", "out"> = circuit(
      { name: "Self", inputs: ["a"], outputs: ["out"] },
      ({ inputs, outputs, add, connect }) => {
        const inner = add(Self, "inner");
        connect(inputs.a, inner.inputs.a);
        connect(inner.outputs.out, outputs.out);
      },
    );
    expectCircuitError(() => Self.describe(), /Recursive component definition .*: Self -> Self/);

    const A: ComponentDefinition<"a", "out"> = circuit(
      { name: "A", inputs: ["a"], outputs: ["out"] },
      ({ inputs, outputs, add, connect }) => {
        const b = add(B, "b");
        connect(inputs.a, b.inputs.a);
        connect(b.outputs.out, outputs.out);
      },
    );
    const B: ComponentDefinition<"a", "out"> = circuit(
      { name: "B", inputs: ["a"], outputs: ["out"] },
      ({ inputs, outputs, add, connect }) => {
        const a = add(A, "a");
        connect(inputs.a, a.inputs.a);
        connect(a.outputs.out, outputs.out);
      },
    );
    expectCircuitError(() => A.describe(), /A -> B -> A/);
    // A failed build does not poison later attempts with a different error.
    expectCircuitError(() => B.describe(), /B -> A -> B/);
  });

  it("rejects asynchronous builders", () => {
    expectCircuitError(
      () => circuit({ name: "C", inputs: [], outputs: [] }, (async () => {}) as never).describe(),
      /must be synchronous/,
    );
  });

  it("accepts feedback connections", () => {
    const Loop = circuit({ name: "Loop", inputs: ["a"], outputs: ["out"] }, ({ inputs, outputs, add, connect }) => {
      const n = add(NAND, "n");
      connect(inputs.a, n.inputs.a);
      connect(n.outputs.out, n.inputs.b);
      connect(n.outputs.out, outputs.out);
    });
    expect(() => Loop.describe()).not.toThrow();
  });
});
