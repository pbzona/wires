import { circuit } from "../index.js";
import { NAND } from "./gates.js";

/**
 * Cross-coupled NAND SR latch with active-low controls.
 *
 * | setN | resetN | q | qBar |
 * |---|---|---|---|
 * | 0 | 1 | 1 | 0 | set
 * | 1 | 0 | 0 | 1 | reset
 * | 1 | 1 | q | qBar | hold (stays X until first set/reset)
 * | 0 | 0 | 1 | 1 | forbidden: q === qBar, not a valid stored state
 *
 * Releasing both inputs from 0 to 1 in the same tick makes the latch
 * oscillate under unit-delay simulation, which `run()` reports as a
 * `StabilizationError`.
 */
export const SRLatch = circuit(
  { name: "SRLatch", inputs: ["setN", "resetN"], outputs: ["q", "qBar"] },
  ({ inputs, add, feed, output }) => {
    const top = add(NAND, "top", { a: inputs.setN }); // b is fed back from bottom, below
    const bottom = add(NAND, "bottom", { a: inputs.resetN, b: top.outputs.out });
    feed(top.inputs.b, bottom.outputs.out); // the feedback wire
    output("q", top.outputs.out);
    output("qBar", bottom.outputs.out);
  },
);
