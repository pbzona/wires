import { describe, expect, it } from "vitest";
import type { BoardScene } from "../src/canvas.js";
import { contains, hitsTrace, layout, overlaps } from "../src/board-layout.js";

const part = { id: "xor", label: "XOR", inputs: ["a", "b"], outputs: ["out"], x: 300, y: 50, composite: true };
const scene: BoardScene = {
  inputs: ["a", "b"], outputs: ["sum"], parts: [part], signals: {}, selected: null, editable: true,
  connections: [{ source: "inputs.a", destination: "xor.inputs.a" }, { source: "xor.outputs.out", destination: "outputs.sum" }],
};

describe("open-level board layout", () => {
  it("places root terminals outside the chips and keeps all relative endpoints in the fitted extent", () => {
    const { bounds, pins, traces } = layout(scene);
    expect(pins.get("inputs.a")!.x).toBeLessThan(part.x);
    expect(pins.get("outputs.sum")!.x).toBeGreaterThan(pins.get("xor.outputs.out")!.x);
    expect(pins.get("inputs.a")!.source).toBe(true);
    expect(pins.get("outputs.sum")!.source).toBe(false);
    expect([...pins.values()].every(p => contains(bounds, p))).toBe(true);
    expect(traces).toHaveLength(2);
  });

  it("lays out a temporary drag without mutating the scene or dropping the incoming wire", () => {
    const { chips, traces } = layout(scene, { id: "xor", x: -250, y: 640 });
    expect(chips[0]).toMatchObject({ x: -250, y: 640 });
    expect(scene.parts[0]).toMatchObject({ x: 300, y: 50 });
    expect(traces[0]!.to.x).toBe(-250);
    expect(traces[0]!.from.x).toBeLessThan(-250);
  });

  it("includes the feedback loop in fit, viewport intersection, and wire picking", () => {
    const { bounds, chips, traces } = layout({ ...scene, connections: [{ source: "xor.outputs.out", destination: "xor.inputs.a" }] });
    const chip = chips[0]!, trace = traces[0]!;
    const onLoop = { x: chip.x + chip.w / 2, y: trace.box.y + trace.box.h };
    const view = { ...onLoop, w: 1, h: 1 };
    expect(contains(bounds, onLoop)).toBe(true);
    expect(overlaps(view, chip)).toBe(false);
    expect(overlaps(view, trace.box)).toBe(true);
    expect(hitsTrace(trace, onLoop, 5)).toBe(true);
    expect(hitsTrace(trace, { ...onLoop, y: onLoop.y - 10 }, 5)).toBe(false);
  });

  it("works with an empty level and with a wire directly from a root input to a root output", () => {
    expect(layout({ ...scene, inputs: [], outputs: [], parts: [] }).bounds.w).toBeGreaterThan(0);
    const { drivers, traces } = layout({ ...scene, parts: [], connections: [{ source: "inputs.a", destination: "outputs.sum" }] });
    expect(traces).toHaveLength(1);
    expect(drivers.get("outputs.sum")).toBe("inputs.a");
  });
});
