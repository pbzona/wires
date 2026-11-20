import { circuit } from "../index.js";
import { AND, NAND, NOT } from "./gates.js";

/** out = a when select = 0, b when select = 1. */
export const Mux = circuit(
  { name: "Mux", inputs: ["a", "b", "select"], outputs: ["out"] },
  ({ inputs, outputs, add, connect }) => {
    const notSelect = add(NOT, "notSelect");
    const pickA = add(NAND, "pickA");
    const pickB = add(NAND, "pickB");
    const combine = add(NAND, "combine");
    connect(inputs.select, notSelect.inputs.a);
    connect(inputs.a, pickA.inputs.a);
    connect(notSelect.outputs.out, pickA.inputs.b);
    connect(inputs.b, pickB.inputs.a);
    connect(inputs.select, pickB.inputs.b);
    connect(pickA.outputs.out, combine.inputs.a);
    connect(pickB.outputs.out, combine.inputs.b);
    connect(combine.outputs.out, outputs.out);
  },
);

/** Routes `in` to `a` when select = 0 or to `b` when select = 1; the other output is 0. */
export const Demux = circuit(
  { name: "Demux", inputs: ["in", "select"], outputs: ["a", "b"] },
  ({ inputs, outputs, add, connect }) => {
    const notSelect = add(NOT, "notSelect");
    const toA = add(AND, "toA");
    const toB = add(AND, "toB");
    connect(inputs.select, notSelect.inputs.a);
    connect(inputs.in, toA.inputs.a);
    connect(notSelect.outputs.out, toA.inputs.b);
    connect(inputs.in, toB.inputs.a);
    connect(inputs.select, toB.inputs.b);
    connect(toA.outputs.out, outputs.a);
    connect(toB.outputs.out, outputs.b);
  },
);
