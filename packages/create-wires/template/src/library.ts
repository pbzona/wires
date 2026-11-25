import type { ComponentDefinition } from "@pbzona/wires";
import type { Entry } from "@pbzona/wires-editor";

type Modules = Record<string, Record<string, unknown>>;

function isDefinition(value: unknown): value is ComponentDefinition {
  return typeof value === "object" && value !== null &&
    "kind" in value && (value.kind === "primitive" || value.kind === "composite") &&
    "name" in value && typeof value.name === "string" &&
    "inputs" in value && Array.isArray(value.inputs) &&
    "outputs" in value && Array.isArray(value.outputs) &&
    "describe" in value && typeof value.describe === "function";
}

// `from` is relative to a new file in chips/, NOT to this module in src/.
export function collectEntries(mine: Modules, examples: Modules, standard: Record<string, unknown>): Entry[] {
  const entries: Entry[] = [];
  function register(group: Entry["group"], from: string, exports: Record<string, unknown>) {
    for (const [exportName, definition] of Object.entries(exports)) {
      if (exportName === "default" || !isDefinition(definition)) continue;
      entries.push({ id: JSON.stringify([group, from, exportName]), group, from, exportName, definition });
    }
  }
  for (const [path, exports] of Object.entries(mine)) {
    register("Mine", path.replace(/^\.\.\/chips\//, "./"), exports);
  }
  for (const [path, exports] of Object.entries(examples)) {
    register("Examples", path, exports);
  }
  register("Standard", "@pbzona/wires/components", standard);
  return entries;
}
