import { circuit } from "../index.js";
import { NAND, NOT } from "./gates.js";
import { Mux } from "./routing.js";

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

/** Follows d while enable is high; otherwise both SR controls are inactive. */
const DLatch = circuit(
  { name: "DLatch", inputs: ["d", "enable"], outputs: ["q"] },
  ({ inputs, add, output }) => {
    const notD = add(NOT, "notD", { a: inputs.d });
    const setN = add(NAND, "setN", { a: inputs.d, b: inputs.enable });
    const resetN = add(NAND, "resetN", { a: notD.outputs.out, b: inputs.enable });
    const latch = add(SRLatch, "latch", { setN: setN.outputs.out, resetN: resetN.outputs.out });
    output("q", latch.outputs.q);
  },
);

/**
 * One rising-edge register bit. With clock low, settle d and load before
 * raising the clock. The first latch tracks the selected bit while low; the
 * second publishes it while high. With load low, q feeds back unchanged.
 */
export const RegisterBit = circuit(
  { name: "RegisterBit", inputs: ["d", "clock", "load"], outputs: ["q"] },
  ({ inputs, add, feed, output }) => {
    const next = add(Mux, "next", { b: inputs.d, select: inputs.load }); // a gets the stored q below
    const notClock = add(NOT, "notClock", { a: inputs.clock });
    const master = add(DLatch, "master", { d: next.outputs.out, enable: notClock.outputs.out });
    const slave = add(DLatch, "slave", { d: master.outputs.q, enable: inputs.clock });
    feed(next.inputs.a, slave.outputs.q);
    output("q", slave.outputs.q);
  },
);
