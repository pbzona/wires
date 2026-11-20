import { describe, expect, it } from "vitest";
import { AND, NAND, NOR, NOT, OR, XNOR, XOR } from "@pbzona/wires/components";
import { type Signal, SimulationError, circuit, gate, simulate } from "@pbzona/wires";
import { binaryCombinations, bit, evaluate } from "./helpers.js";

describe("NAND primitive", () => {
  const table: Array<[Signal, Signal, Signal]> = [
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
    [0, "X", 1],
    ["X", 0, 1],
    [1, "X", "X"],
    ["X", 1, "X"],
    ["X", "X", "X"],
  ];
  it.each(table)("NAND(%s, %s) = %s", (a, b, out) => {
    expect(evaluate(NAND, { a, b }).out).toBe(out);
  });

  it("leaves outputs unknown while inputs are unassigned", () => {
    const settled = simulate(NAND).run();
    expect(settled.read("out")).toBe("X");
    expect(settled.set({ a: 0 }).run().read("out")).toBe(1);
  });
});

describe("custom primitives", () => {
  it("supports multiple outputs", () => {
    const Split = gate({
      name: "Split",
      inputs: ["a", "b", "c"],
      outputs: ["all", "any", "first"],
      evaluate: ({ a, b, c }) => ({
        all: a === 1 && b === 1 && c === 1 ? 1 : a === 0 || b === 0 || c === 0 ? 0 : "X",
        any: a === 1 || b === 1 || c === 1 ? 1 : a === 0 && b === 0 && c === 0 ? 0 : "X",
        first: a,
      }),
    });
    expect(evaluate(Split, { a: 1, b: 1, c: 1 })).toEqual({ all: 1, any: 1, first: 1 });
    expect(evaluate(Split, { a: 0, b: 1, c: "X" })).toEqual({ all: 0, any: 1, first: 0 });
    expect(evaluate(Split, { a: "X", b: 0, c: 0 })).toEqual({ all: 0, any: "X", first: "X" });
  });

  it("supports primitives without inputs via the initial evaluation", () => {
    const HIGH = gate({ name: "HIGH", inputs: [], outputs: ["out"], evaluate: () => ({ out: 1 }) });
    const start = simulate(HIGH);
    expect(start.read("out")).toBe("X");
    expect(start.run().read("out")).toBe(1);
  });

  it("can be mixed with standard components", () => {
    const LOW = gate({ name: "LOW", inputs: [], outputs: ["out"], evaluate: () => ({ out: 0 }) });
    const C = circuit({ name: "C", inputs: [], outputs: ["out"] }, ({ add, output }) => {
      const low = add(LOW, "low");
      const not = add(NOT, "not", { a: low.outputs.out });
      output("out", not.outputs.out);
    });
    expect(evaluate(C, {}).out).toBe(1);
  });

  const badGate = (name: string, evaluate: () => unknown) =>
    gate({ name, inputs: ["a"], outputs: ["out"], evaluate: evaluate as never });
  const wrapped = (inner: ReturnType<typeof badGate>) =>
    circuit({ name: "Wrap", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
      const g = add(inner, "bad", { a: inputs.a });
      output("out", g.outputs.out);
    });
  const runError = (inner: ReturnType<typeof badGate>) => {
    const start = simulate(wrapped(inner));
    try {
      start.run();
    } catch (error) {
      expect(error).toBeInstanceOf(SimulationError);
      return (error as Error).message;
    }
    throw new Error("expected run() to throw");
  };

  it("reports missing outputs", () => {
    expect(runError(badGate("Missing", () => ({})))).toBe(
      'Primitive Missing at root.bad did not return output "out"',
    );
  });

  it("reports unexpected outputs", () => {
    expect(runError(badGate("Extra", () => ({ out: 1, extra: 0 })))).toMatch(
      /^Primitive Extra at root\.bad returned unexpected output "extra"/,
    );
  });

  it("reports invalid signal values", () => {
    expect(runError(badGate("Bool", () => ({ out: true })))).toBe(
      'Primitive Bool at root.bad returned an invalid signal for output "out": true (expected 0, 1 or "X")',
    );
    expect(runError(badGate("Two", () => ({ out: 2 })))).toMatch(/invalid signal for output "out": 2/);
    expect(runError(badGate("Lower", () => ({ out: "x" })))).toMatch(/invalid signal for output "out": "x"/);
  });

  it("reports non-object results and thrown errors", () => {
    expect(runError(badGate("Nothing", () => undefined))).toMatch(/must return an object of outputs/);
    expect(
      runError(
        badGate("Throws", () => {
          throw new Error("boom");
        }),
      ),
    ).toBe("Primitive Throws at root.bad threw during evaluation: boom");
  });
});

describe("standard combinational gates", () => {
  const cases = [
    ["AND", AND, (a: boolean, b: boolean) => a && b],
    ["OR", OR, (a: boolean, b: boolean) => a || b],
    ["NOR", NOR, (a: boolean, b: boolean) => !(a || b)],
    ["XOR", XOR, (a: boolean, b: boolean) => a !== b],
    ["XNOR", XNOR, (a: boolean, b: boolean) => a === b],
    ["NAND", NAND, (a: boolean, b: boolean) => !(a && b)],
  ] as const;

  for (const [name, def, fn] of cases) {
    it(`${name} truth table`, () => {
      for (const row of binaryCombinations(["a", "b"] as const)) {
        expect(evaluate(def, row).out, `${name}(${row.a}, ${row.b})`).toBe(bit(fn(row.a === 1, row.b === 1)));
      }
    });
  }

  it("NOT truth table", () => {
    expect(evaluate(NOT, { a: 0 }).out).toBe(1);
    expect(evaluate(NOT, { a: 1 }).out).toBe(0);
    expect(evaluate(NOT, { a: "X" }).out).toBe("X");
  });

  it("propagates dominant values through unknowns", () => {
    expect(evaluate(AND, { a: 0 }).out).toBe(0);
    expect(evaluate(OR, { a: 1 }).out).toBe(1);
    expect(evaluate(AND, { a: 1 }).out).toBe("X");
    expect(evaluate(XOR, { a: 1 }).out).toBe("X");
  });

  it("are built only from NAND primitives", () => {
    const primitives = (d: ReturnType<typeof AND.describe>): string[] =>
      d.kind === "primitive" ? [d.definition] : d.components.flatMap(primitives);
    for (const def of [NOT, AND, OR, NOR, XOR, XNOR]) {
      expect(new Set(primitives(def.describe()))).toEqual(new Set(["NAND"]));
    }
  });
});
