import { circuit, simulate } from "@pbzona/wires";
import { FullAdder } from "@pbzona/wires/components";
import { expect, test } from "vitest";
import type { Draft, Entry } from "../src/model.js";
import { makeScene } from "../src/scene.js";

test("a collapsed wide hierarchy only lays out the current level, with signal paths relative to it", () => {
  const bank = circuit({ name: "Bank", inputs: ["drive"], outputs: ["bit"] }, ({ inputs, add, output }) => {
    for (let i = 0; i < 64; i++) {
      const adder = add(FullAdder, `adder${i}`, { a: inputs.drive, b: inputs.drive, carryIn: inputs.drive });
      if (i === 0) output("bit", adder.outputs.sum);
    }
  });
  const entry: Entry = { id: "mine/Bank", group: "Mine", definition: bank, exportName: "Bank", from: "./Bank.js" };
  const library = new Map([[entry.id, entry]]);
  const draft: Draft = { name: "Top", inputs: ["a"], outputs: ["out"], parts: [{ id: "bank", entry: entry.id, x: 10, y: 10 }],
    connections: [{ source: "inputs.a", destination: "bank.inputs.drive" }, { source: "bank.outputs.bit", destination: "outputs.out" }] };
  const top = circuit({ name: "Top", inputs: ["a"], outputs: ["out"] }, ({ add, inputs, output }) => {
    const part = add(bank, "bank", { drive: inputs.a }); output("out", part.outputs.bit);
  });
  const { signals } = simulate(top).set({ a: 1 }).run().inspect();
  const root = makeScene(draft, library, undefined, null, signals);
  expect(root.parts.map(p => p.id)).toEqual(["bank"]);
  expect(Object.keys(root.signals)).toHaveLength(4);
  expect(root.signals["outputs.out"]).toBe(1);
  const node = bank.describe();
  const inside = makeScene(draft, library, { path: "root.bank", node }, null, signals);
  expect(inside.editable).toBe(false);
  expect(inside.parts).toHaveLength(64);
  expect(inside.signals["adder63.outputs.sum"]).toBe(1);
  const nested = makeScene(draft, library, { path: "root.bank.adder63", node: node.components[63]! }, null, signals);
  expect(nested.signals["outputs.sum"]).toBe(1);
  expect(nested.connections.every(w => !w.source.startsWith("root."))).toBe(true);
});
