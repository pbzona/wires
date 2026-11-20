import { describe, expect, it } from "vitest";
import { Demux, FullAdder, HalfAdder, Mux } from "@pbzona/wires/components";
import { binaryCombinations, evaluate } from "./helpers.js";

describe("arithmetic", () => {
  it("HalfAdder truth table", () => {
    for (const { a, b } of binaryCombinations(["a", "b"] as const)) {
      const total = a + b;
      expect(evaluate(HalfAdder, { a, b }), `${a}+${b}`).toEqual({ sum: total & 1, carry: total >> 1 });
    }
  });

  it("FullAdder truth table", () => {
    for (const { a, b, carryIn } of binaryCombinations(["a", "b", "carryIn"] as const)) {
      const total = a + b + carryIn;
      expect(evaluate(FullAdder, { a, b, carryIn }), `${a}+${b}+${carryIn}`).toEqual({
        sum: total & 1,
        carryOut: total >> 1,
      });
    }
  });
});

describe("routing", () => {
  it("Mux truth table", () => {
    for (const { a, b, select } of binaryCombinations(["a", "b", "select"] as const)) {
      expect(evaluate(Mux, { a, b, select }).out, `a=${a} b=${b} select=${select}`).toBe(select === 0 ? a : b);
    }
  });

  it("Demux truth table", () => {
    for (const row of binaryCombinations(["in", "select"] as const)) {
      expect(evaluate(Demux, row), `in=${row.in} select=${row.select}`).toEqual({
        a: row.select === 0 ? row.in : 0,
        b: row.select === 1 ? row.in : 0,
      });
    }
  });

  it("Mux is pessimistic about an unknown select", () => {
    expect(evaluate(Mux, { a: 0, b: 0, select: "X" }).out).toBe(0);
    expect(evaluate(Mux, { a: 1, b: 1, select: "X" }).out).toBe("X");
    expect(evaluate(Mux, { a: 1, select: 0 }).out).toBe(1);
  });
});
