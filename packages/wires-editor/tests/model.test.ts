import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "@pbzona/wires";
import { AND, NAND, XOR } from "@pbzona/wires/components";
import { describe, expect, it } from "vitest";
import { compileDraft, exampleDraft, generateSource, renamePart, validIdentifier, type Draft, type Entry } from "../src/model.js";

const components = "@pbzona/wires/components";
const standard: Entry[] = [XOR, AND].map((definition) => ({
  id: `std:${definition.name}`, group: "Standard", exportName: definition.name, from: components, definition,
}));

it("starts with a working half adder made from the standard chips, not a similarly named learner chip", () => {
  const entries: Entry[] = [{ ...standard[0]!, id: "mine:XOR", group: "Mine", from: "./XOR.js" }, ...standard];
  const draft = exampleDraft(entries);
  expect(draft.name).toBe("MyHalfAdder");
  expect(draft.parts.map(({ entry, x, y }) => [entry, x, y])).toEqual([["std:XOR", 300, 50], ["std:AND", 300, 200]]);
  const state = simulate(compileDraft(draft, entries));
  expect(state.readAll()).toEqual({ sum: "X", carry: "X" });
  for (const a of [0, 1] as const) for (const b of [0, 1] as const) {
    expect(state.set({ a, b }).run().readAll()).toEqual({ sum: a ^ b, carry: a & b });
  }
  const source = generateSource(draft, entries);
  expect(source).toContain('const myXor = add(XOR, "myXor", { a: inputs.a, b: inputs.b });');
  expect(source).toContain('output("carry", myAnd.outputs.out);');
  expect(source).not.toMatch(/\bfeed\b|\.\/XOR\.js/);
  draft.parts[0]!.x += 400;
  draft.connections.reverse();
  expect(generateSource(draft, entries)).toBe(source);
  expect(() => exampleDraft(entries.filter((entry) => entry.id !== "std:XOR"))).toThrow(/standard.*XOR/i);
});

it("wraps wide pin lists and wiring maps in the source drawer", () => {
  const names = Array.from({ length: 16 }, (_, i) => `bit_${i}`);
  const wide: Draft = { name: "Wide", inputs: names, outputs: ["out"], parts: [], connections: [{ source: "inputs.bit_0", destination: "outputs.out" }] };
  const entry: Entry = { id: "Wide", definition: compileDraft(wide, []), from: "./Wide.ts", exportName: "Wide", group: "Mine" };
  const wrapped: Draft = { ...wide, name: "Wrapper", parts: [{ id: "wide", x: 0, y: 0, entry: entry.id }], connections: [
    ...names.map(n => ({ source: `inputs.${n}`, destination: `wide.inputs.${n}` })),
    { source: "wide.outputs.out", destination: "outputs.out" },
  ] };
  const source = generateSource(wrapped, [entry]);
  expect(source).toContain('    inputs: [\n      "bit_0",');
  expect(source).toContain('    const wide = add(Wide, "wide", {\n      bit_0: inputs.bit_0,');
  expect(source.split("\n").every(line => line.length <= 100)).toBe(true);
});

it("accepts direct wires, fan-out and legal port names that are not JS bindings", () => {
  const draft: Draft = {
    name: "PassThrough", inputs: ["class"], outputs: ["out", "constructor"], parts: [],
    connections: [
      { source: "inputs.class", destination: "outputs.out" },
      { source: "inputs.class", destination: "outputs.constructor" },
    ],
  };
  const state = simulate(compileDraft(draft, [])).set({ class: 1 }).step();
  expect(state.readAll()).toEqual({ out: 1, constructor: 1 });
  expect(generateSource(draft, [])).toContain('output("constructor", inputs.class);');
});

it("renames a part and its connected pins in the saved module", () => {
  const draft = exampleDraft(standard);
  expect(() => renamePart(draft, "myXor", "myAnd")).toThrow(/already a part/);
  expect(() => renamePart(draft, "myXor", "inputs")).toThrow(/instance name/);
  renamePart(draft, "myXor", "sumGate");
  const source = generateSource(draft, standard);
  expect(source).toContain('output("sum", sumGate.outputs.out)');
  expect(source).not.toContain("myXor");
});

describe("draft validation", () => {
  const invalid: { problem: string; edit: (d: Draft) => void; error: RegExp }[] = [
    { problem: "unknown palette entry", edit: d => { d.parts[0]!.entry = "gone"; }, error: /unknown.*gone/i },
    { problem: "missing part input", edit: d => { d.connections.shift(); }, error: /myXor\.inputs\.a.*not connected/ },
    { problem: "missing circuit output", edit: d => { d.connections.pop(); }, error: /outputs\.carry.*not driven/ },
    { problem: "duplicate driver", edit: d => { d.connections.push(d.connections[0]!); }, error: /myXor\.inputs\.a.*multiple drivers/ },
    { problem: "component input as a source", edit: d => { d.connections[0]!.source = "myAnd.inputs.a"; }, error: /source.*myAnd\.inputs\.a/i },
    { problem: "circuit input as a sink", edit: d => { d.connections[0]!.destination = "inputs.a"; }, error: /destination.*inputs\.a/i },
    { problem: "unknown inherited port", edit: d => { d.connections[0]!.source = "inputs.toString"; }, error: /source.*toString/i },
    { problem: "extra path segment", edit: d => { d.connections[0]!.destination += ".extra"; }, error: /destination.*extra/i },
    { problem: "duplicate part id", edit: d => { d.parts.push({ ...d.parts[0]! }); }, error: /duplicate.*myXor/i },
    { problem: "duplicate port", edit: d => { d.outputs.push("a"); }, error: /duplicate port name/i },
    { problem: "reserved instance name", edit: d => { d.parts.push({ ...d.parts[0]!, id: "inputs" }); }, error: /reserved name/ },
    { problem: "reserved export name", edit: d => { d.name = "await"; }, error: /invalid.*await/i },
  ];
  it.each(invalid)("rejects $problem for both simulation and source", ({ edit, error }) => {
    const draft = exampleDraft(standard);
    edit(draft);
    for (const action of [compileDraft, generateSource]) expect(() => action(draft, standard)).toThrow(error);
  });

  it("rejects ambiguous palette ids without treating a shared display name as the id", () => {
    const draft = exampleDraft(standard);
    expect(() => compileDraft(draft, [...standard, { ...standard[0]!, from: "./Different.js" }])).toThrow(/duplicate.*std:XOR/i);
  });

  it("accepts only wires names that can also bind a named export", () => {
    for (const name of ["_", "MyChip_2", "add", "type", "constructor"]) expect(validIdentifier(name), name).toBe(true);
    for (const name of ["", "a.b", "x-y", "9Bit", "Chip\n", "__proto__", "class", "let", "yield", "await", "interface", "eval", "arguments"]) {
      expect(validIdentifier(name), name).toBe(false);
    }
  });
});

it("type-checks and runs the saved module with real imports, including name collisions and feedback", () => {
  // Same named export, two different modules and definitions. Neither export is named after its definition.
  const entries: Entry[] = [
    { id: "mine", group: "Mine", definition: NAND, exportName: "feed", from: "./Cell.js" },
    { id: "example", group: "Examples", definition: AND, exportName: "feed", from: "../examples/Cell.js" },
  ];
  const draft: Draft = {
    name: "circuit", inputs: ["a", "b"], outputs: ["left", "right", "self"],
    parts: [
      { id: "add", entry: "mine", x: 0, y: 0 },
      { id: "class", entry: "example", x: 0, y: 0 },
      { id: "feed2", entry: "example", x: 0, y: 0 },
    ],
    connections: [
      { source: "inputs.a", destination: "add.inputs.a" },
      { source: "class.outputs.out", destination: "add.inputs.b" }, // Later source
      { source: "add.outputs.out", destination: "class.inputs.a" }, // Earlier source
      { source: "inputs.b", destination: "class.inputs.b" },
      { source: "inputs.a", destination: "feed2.inputs.a" },
      { source: "feed2.outputs.out", destination: "feed2.inputs.b" }, // Self-feedback
      { source: "add.outputs.out", destination: "outputs.left" },
      { source: "class.outputs.out", destination: "outputs.right" },
      { source: "feed2.outputs.out", destination: "outputs.self" },
    ],
  };
  const source = generateSource(draft, entries);
  // Only the later source and the self-loop need feed(); the earlier source belongs in add().
  expect(source.match(/^    feed\(/gm)).toHaveLength(2);
  expect(source.match(/from "\.\.\/examples\/Cell\.js"/g)).toHaveLength(1);
  const definition = compileDraft(draft, entries);
  const start = simulate(definition, { trace: true }).set({ a: 0, b: 1 });
  const end = start.run();
  expect(start.readAll()).toEqual({ left: "X", right: "X", self: "X" });
  expect(end.readAll()).toEqual({ left: 1, right: 1, self: 0 });

  // Under the package so ordinary Node/tsc resolution can use the installed public wires package.
  const dir = mkdtempSync(join(fileURLToPath(new URL("../", import.meta.url)), ".model-test-"));
  try {
    mkdirSync(join(dir, "chips"));
    mkdirSync(join(dir, "examples"));
    writeFileSync(join(dir, "chips/circuit.ts"), source);
    writeFileSync(join(dir, "chips/Cell.ts"), `export { NAND as feed } from "${components}";`);
    writeFileSync(join(dir, "examples/Cell.ts"), `export { AND as feed } from "${components}";`);
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { module: "NodeNext", target: "ES2022", strict: true, noUnusedLocals: true,
        noUnusedParameters: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist" },
      include: ["chips", "examples"],
    }));
    const tsc = fileURLToPath(new URL("./bin/tsc", import.meta.resolve("typescript/package.json")));
    const compile = spawnSync(process.execPath, [tsc, "-p", "."], { cwd: dir, encoding: "utf8" });
    expect(compile.status, compile.stdout + compile.stderr).toBe(0);

    writeFileSync(join(dir, "run.mjs"), `
      import { circuit as saved } from "./dist/chips/circuit.js";
      import { simulate } from "@pbzona/wires";
      const start = simulate(saved, { trace: true }).set({ a: 0, b: 1 });
      const end = start.run();
      console.log(JSON.stringify([saved.describe(), start.inspect(), end.inspect(), end.trace()]));
    `);
    const run = spawnSync(process.execPath, ["run.mjs"], { cwd: dir, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([definition.describe(), start.inspect(), end.inspect(), end.trace()]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
