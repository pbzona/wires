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
  ({ inputs, outputs, add, connect }) => {
    const top = add(NAND, "top");
    const bottom = add(NAND, "bottom");
    connect(inputs.setN, top.inputs.a);
    connect(bottom.outputs.out, top.inputs.b);
    connect(inputs.resetN, bottom.inputs.a);
    connect(top.outputs.out, bottom.inputs.b);
    connect(top.outputs.out, outputs.q);
    connect(bottom.outputs.out, outputs.qBar);
  },
);
