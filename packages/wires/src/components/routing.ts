import { circuit } from "../index.js";
import { AND, NAND, NOT } from "./gates.js";

/** out = a when select = 0, b when select = 1. */
export const Mux = circuit(
  { name: "Mux", inputs: ["a", "b", "select"], outputs: ["out"] },
  ({ inputs, add, output }) => {
    const notSelect = add(NOT, "notSelect", { a: inputs.select });
    const pickA = add(NAND, "pickA", { a: inputs.a, b: notSelect.outputs.out });
    const pickB = add(NAND, "pickB", { a: inputs.b, b: inputs.select });
    const combine = add(NAND, "combine", { a: pickA.outputs.out, b: pickB.outputs.out });
    output("out", combine.outputs.out);
  },
);

/** Routes `in` to `a` when select = 0 or to `b` when select = 1; the other output is 0. */
export const Demux = circuit(
  { name: "Demux", inputs: ["in", "select"], outputs: ["a", "b"] },
  ({ inputs, add, output }) => {
    const notSelect = add(NOT, "notSelect", { a: inputs.select });
    const toA = add(AND, "toA", { a: inputs.in, b: notSelect.outputs.out });
    const toB = add(AND, "toB", { a: inputs.in, b: inputs.select });
    output("a", toA.outputs.out);
    output("b", toB.outputs.out);
  },
);
