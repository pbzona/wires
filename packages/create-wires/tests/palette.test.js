import assert from "node:assert/strict";
import test from "node:test";
import * as standard from "@pbzona/wires/components";
import { collectEntries } from "../template/src/library.ts";

test("collects every named definition, preserving group, module and exported binding", () => {
  const mine = { "../chips/nested/pair.ts": { Alias: standard.NAND, HalfAdder: standard.AND, label: "hi" } };
  const examples = { "../examples/foo.ts": { HalfAdder: standard.NOT, default: standard.NOR } };
  const entries = collectEntries(mine, examples, standard);
  const projectEntries = entries.filter(e => e.group !== "Standard");
  assert.deepEqual(projectEntries.map(e => [e.group, e.from, e.exportName, e.definition.name]), [
    ["Mine", "./nested/pair.ts", "Alias", "NAND"],
    ["Mine", "./nested/pair.ts", "HalfAdder", "AND"],
    ["Examples", "../examples/foo.ts", "HalfAdder", "NOT"],
  ]);
  const standards = entries.filter(e => e.group === "Standard");
  assert.deepEqual(standards.map(e => e.exportName).sort(), Object.keys(standard).sort());
  assert.ok(standards.every(e => e.from === "@pbzona/wires/components"));
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length);
  // A change in the definition's internal name doesn't change its library identity.
  mine["../chips/nested/pair.ts"].Alias = standard.XOR;
  assert.deepEqual(collectEntries(mine, examples, standard).map(e => e.id), entries.map(e => e.id));
});
