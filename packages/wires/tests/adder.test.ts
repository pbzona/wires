import { describe, expect, it } from "vitest";
import { FullAdder } from "@pbzona/wires/components";
import { type Signal, type SourcePort, circuit, elaborate, simulate } from "@pbzona/wires";

const WIDTH = 4;

/** A four-bit ripple-carry adder, built only with the public API. */
const RippleCarryAdder4 = circuit(
  {
    name: "RippleCarryAdder4",
    inputs: ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3", "carryIn"],
    outputs: ["s0", "s1", "s2", "s3", "carryOut"],
  },
  ({ inputs, add, output }) => {
    let carry: SourcePort = inputs.carryIn;
    for (const i of [0, 1, 2, 3] as const) {
      const fa = add(FullAdder, `fa${i}`, { a: inputs[`a${i}`], b: inputs[`b${i}`], carryIn: carry });
      output(`s${i}`, fa.outputs.sum);
      carry = fa.outputs.carryOut;
    }
    output("carryOut", carry);
  },
);

const bitsOf = (prefix: "a" | "b", value: number) =>
  Object.fromEntries(Array.from({ length: WIDTH }, (_, i) => [`${prefix}${i}`, ((value >> i) & 1) as Signal]));

/** Little-endian bits to a number; NaN if any bit is unknown. */
const toNumber = (bits: readonly Signal[]) =>
  bits.reduce<number>((acc, b, i) => (b === "X" ? Number.NaN : acc + b * 2 ** i), 0);

describe("four-bit ripple-carry adder", () => {
  it("adds all 512 combinations of operands and carry-in", () => {
    let sim = simulate(RippleCarryAdder4);
    let checked = 0;
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        for (const carryIn of [0, 1] as const) {
          sim = sim.set({ ...bitsOf("a", a), ...bitsOf("b", b), carryIn }).run();
          const out = sim.readAll();
          const sum = toNumber([out.s0, out.s1, out.s2, out.s3, out.carryOut]);
          expect(sum, `${a} + ${b} + ${carryIn}`).toBe(a + b + carryIn);
          checked++;
        }
      }
    }
    expect(checked).toBe(512);
  });

  it("gives the same answers from a fresh simulator", () => {
    for (const [a, b, carryIn] of [[15, 15, 1], [0, 0, 0], [9, 6, 1], [7, 8, 0]] as const) {
      const out = simulate(RippleCarryAdder4)
        .set({ ...bitsOf("a", a), ...bitsOf("b", b), carryIn })
        .run()
        .readAll();
      const total = a + b + carryIn;
      expect(out).toEqual({
        s0: total & 1,
        s1: (total >> 1) & 1,
        s2: (total >> 2) & 1,
        s3: (total >> 3) & 1,
        carryOut: (total >> 4) & 1,
      });
    }
  });

  it("is a pure NAND network with hierarchical paths", () => {
    const netlist = elaborate(RippleCarryAdder4);
    // Per full adder: 2 half adders x (XOR 4 + AND 2) + OR 3 = 15 NANDs.
    expect(netlist.gates).toHaveLength(WIDTH * 15);
    expect(new Set(netlist.gates.map((g) => g.definition))).toEqual(new Set(["NAND"]));
    expect(netlist.gates.map((g) => g.path)).toContain("root.fa3.second.xor.n4");
    expect(netlist.outputs.carryOut).toBe("root.fa3.or.nand.outputs.out");
  });
});
