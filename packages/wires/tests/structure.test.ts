import { describe, expect, it } from "vitest";
import { AND, NAND, NOT, SRLatch } from "@pbzona/wires/components";
import {
  CircuitError,
  circuit,
  gate,
  type ComponentDefinition,
  type ComponentInstance,
  type SourcePort,
} from "@pbzona/wires";

const BUF = gate({ name: "BUF", inputs: ["a"], outputs: ["out"], evaluate: ({ a }) => ({ out: a }) });

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
      circuit({ name: "Pair", inputs: ["a"], outputs: ["x", "y"] }, ({ inputs, add, output }) => {
        const first = add(NOT, { a: inputs.a });
        const second = add(NOT, { a: inputs.a });
        const named = add(NAND, "n", { a: inputs.a, b: inputs.a });
        expect([first.name, second.name, named.name]).toEqual(["NOT#0", "NOT#1", "n"]);
        output("x", first.outputs.out);
        output("y", second.outputs.out);
      });
    expect(make().describe()).toEqual(make().describe());
    expect(make().describe().components.map((c) => c.id)).toEqual(["root.NOT#0", "root.NOT#1", "root.n"]);
  });

  it("builds immediately and only once", () => {
    let runs = 0;
    const C = circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, output }) => {
      runs++;
      output("out", inputs.a);
    });
    expect(runs).toBe(1);
    C.describe();
    C.describe();
    expect(runs).toBe(1);
  });
});

describe("wiring", () => {
  it("wires inputs when a component is added", () => {
    const C = circuit({ name: "C", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
      const n = add(NAND, "n", { a: inputs.a, b: inputs.b });
      output("out", n.outputs.out);
    });
    expect(C.describe().connections).toEqual([
      { source: "root.inputs.a", destination: "root.n.inputs.a" },
      { source: "root.inputs.b", destination: "root.n.inputs.b" },
      { source: "root.n.outputs.out", destination: "root.outputs.out" },
    ]);
  });

  it("feeds inputs later, for feedback", () => {
    expect(SRLatch.describe().connections).toContainEqual({
      source: "root.bottom.outputs.out",
      destination: "root.top.inputs.b",
    });
  });

  it("allows fan-out and direct input-to-output wires", () => {
    const Fan = circuit({ name: "Fan", inputs: ["a"], outputs: ["x", "y"] }, ({ inputs, output }) => {
      output("x", inputs.a);
      output("y", inputs.a);
    });
    expect(Fan.describe().connections).toHaveLength(2);
  });

  it("accepts feedback loops", () => {
    const Loop = circuit({ name: "Loop", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, feed, output }) => {
      const n = add(NAND, "n", { a: inputs.a });
      feed(n.inputs.b, n.outputs.out);
      output("out", n.outputs.out);
    });
    expect(() => Loop.describe()).not.toThrow();
  });
});

describe("validation", () => {
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
    expectCircuitError(
      () => gate({ name: "G", inputs: [1n as never], outputs: [], evaluate: () => ({}) }),
      /^G: Invalid input port name 1n/,
    );
    expectCircuitError(() => gate({ name: "G", inputs: [], outputs: [], evaluate: 1 as never }), /evaluate must be/);
  });

  it("rejects duplicate and reserved instance names", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: [] }, ({ inputs, add }) => {
          add(BUF, "x", { a: inputs.a });
          add(BUF, "x", { a: inputs.a });
        }),
      /^C: Duplicate component instance name "x"/,
    );
    expectCircuitError(
      () => circuit({ name: "C", inputs: ["a"], outputs: [] }, ({ inputs, add }) => void add(BUF, "inputs", { a: inputs.a })),
      /reserved name/,
    );
  });

  it("rejects duplicate names even if reading the wiring adds another part", () => {
    expectCircuitError(
      () => circuit({ name: "Pair", inputs: ["a"], outputs: [] }, ({ inputs, add }) => {
        add(BUF, "part", {
          get a() {
            return add(BUF, "part", { a: inputs.a }).outputs.out;
          },
        });
      }),
      /^Pair: Duplicate component instance name "part"/,
    );
  });

  it("rejects inputs that the component doesn't have", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
          // @ts-expect-error NAND has no input "c"
          const n = add(NAND, "n", { a: inputs.a, b: inputs.a, c: inputs.a });
          output("out", n.outputs.out);
        }),
      /^C: NAND has no input "c" \(its inputs are a, b\)/,
    );
  });

  it("rejects sources that don't exist", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
          const first = add(BUF, "first", { a: inputs.a });
          // @ts-expect-error BUF has no output "result"
          const n = add(NAND, "n", { a: inputs.a, b: first.outputs.result });
          output("out", n.outputs.out);
        }),
      /^C: n\.inputs\.b is not a port \(got undefined\); check that the port name exists/,
    );
  });

  it("rejects component inputs used as sources", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
          const b = add(BUF, "b", { a: inputs.a });
          // @ts-expect-error a component input is not a source
          output("out", b.inputs.a);
        }),
      /^C: b\.inputs\.a can't be used as a source for outputs\.out: it's a component input/,
    );
  });

  it("only feeds component inputs", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, feed, output }) => {
          const b = add(BUF, "b", { a: inputs.a });
          // @ts-expect-error a component output can't be fed
          feed(b.outputs.out, inputs.a);
          output("out", b.outputs.out);
        }),
      /^C: feed\(\) can only feed a component input, not b\.outputs\.out/,
    );
  });

  it("rejects outputs that the circuit doesn't have", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out"] }, ({ inputs, output }) => {
          // @ts-expect-error C has no output "other"
          output("other", inputs.a);
        }),
      /^C: "other" is not an output of C \(its outputs are out\)/,
    );
  });

  it("rejects multiple drivers", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, output }) => {
          output("out", inputs.a);
          output("out", inputs.b);
        }),
      /outputs\.out has multiple drivers \(inputs\.a and inputs\.b\)/,
    );
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, feed, output }) => {
          const n = add(NAND, "n", { a: inputs.a, b: inputs.a });
          feed(n.inputs.b, inputs.b);
          output("out", n.outputs.out);
        }),
      /n\.inputs\.b has multiple drivers \(inputs\.a and inputs\.b\)/,
    );
  });

  it("reports unconnected internal inputs and undriven outputs together", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: ["a"], outputs: ["out", "other"] }, ({ inputs, add, output }) => {
          const n = add(NAND, "n", { a: inputs.a });
          output("out", n.outputs.out);
        }),
      /input n\.inputs\.b is not connected[\s\S]*output outputs\.other is not driven/,
    );
  });

  it("reports errors where the circuit is defined", () => {
    expectCircuitError(
      () => circuit({ name: "Early", inputs: [], outputs: ["out"] }, () => {}),
      /^Early: Invalid circuit:\n {2}- output outputs\.out is not driven/,
    );
  });

  it("rejects ports of other circuits", () => {
    let stolen: SourcePort | undefined;
    circuit({ name: "Other", inputs: ["a"], outputs: ["out"] }, ({ inputs, output }) => {
      stolen = inputs.a;
      output("out", inputs.a);
    });
    expectCircuitError(
      () => circuit({ name: "C", inputs: [], outputs: ["out"] }, ({ output }) => output("out", stolen!)),
      /belongs to circuit "Other", which is not part of this circuit/,
    );

    let otherInstance: ComponentInstance<"a", "out"> | undefined;
    circuit({ name: "Other2", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
      otherInstance = add(BUF, "b", { a: inputs.a });
      output("out", otherInstance.outputs.out);
    });
    expectCircuitError(
      () => circuit({ name: "C", inputs: [], outputs: ["out"] }, ({ output }) => output("out", otherInstance!.outputs.out)),
      /belongs to instance "b"/,
    );
  });

  it("rejects things that are not definitions", () => {
    expectCircuitError(
      () =>
        circuit({ name: "C", inputs: [], outputs: [] }, ({ add }) => {
          add({ kind: "primitive", name: "Fake", inputs: [], outputs: [], describe: () => ({}) } as never);
        }),
      /add\(\) expects a component definition/,
    );
  });

  it("cannot contain components that are defined later (so no recursion)", () => {
    // `var` makes the later definition visible as `undefined` instead of throwing a ReferenceError.
    // eslint-disable-next-line no-var
    var Later: ComponentDefinition<"a", "out"> | undefined;
    expectCircuitError(
      () =>
        circuit({ name: "Before", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
          const later = add(Later!, "later", { a: inputs.a });
          output("out", later.outputs.out);
        }),
      /^Before: add\(\) received undefined; a circuit can only contain components defined before it/,
    );
    Later = BUF;
    expect(Later).toBe(BUF);
  });

  it("rejects use of the builder after it finished", () => {
    let saved: { add: (d: typeof BUF) => unknown } | undefined;
    circuit({ name: "C", inputs: [], outputs: [] }, (b) => {
      saved = b;
    });
    expectCircuitError(() => saved!.add(BUF), /after the circuit builder finished/);
  });

  it("closes the builder even when its callback throws", () => {
    let addLater: () => unknown;
    expect(() => circuit({ name: "C", inputs: [], outputs: [] }, ({ add }) => {
      addLater = () => add(BUF);
      throw new Error("build failed");
    })).toThrow("build failed");
    expectCircuitError(() => addLater(), /after the circuit builder finished/);
  });

  it("reports an asynchronous builder without leaking a second, unhandled error", async () => {
    expectCircuitError(
      () => circuit({ name: "C", inputs: [], outputs: [] }, async ({ add }) => {
        await Promise.resolve();
        add(BUF); // the builder has already closed
      }),
      /must be synchronous/,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
