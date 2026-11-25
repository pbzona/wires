import { circuit, type ComponentDefinition, type ComponentInstance, type SourcePort } from "@pbzona/wires";

export type Entry = {
  id: string;
  group: "Mine" | "Examples" | "Standard";
  definition: ComponentDefinition;
  exportName: string;
  /** Module specifier as seen from a saved file in chips/. */
  from: string;
};

export type Draft = {
  name: string;
  inputs: string[];
  outputs: string[];
  parts: { id: string; entry: string; x: number; y: number }[];
  connections: { source: string; destination: string }[];
};

// A chip name must work both as a wires name and as a binding in a strict ES module.
const reserved = new Set((
  "arguments await break case catch class const continue debugger default delete do else enum eval export extends " +
  "false finally for function if implements import in instanceof interface let new null package private protected " +
  "public return static super switch this throw true try typeof var void while with yield __proto__"
).split(" "));

export function validIdentifier(name: string): boolean {
  return typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !reserved.has(name);
}

/** Remove one instance and its incoming and outgoing wires from this draft. */
export function removePart(draft: Draft, id: string): boolean {
  const index = draft.parts.findIndex(part => part.id === id);
  if (index === -1) return false;
  draft.parts.splice(index, 1);
  const prefix = `${id}.`;
  draft.connections = draft.connections.filter(wire => !wire.source.startsWith(prefix) && !wire.destination.startsWith(prefix));
  return true;
}

/** Rename a placed instance and its local endpoints without touching the chip definition. */
export function renamePart(draft: Draft, oldId: string, id: string): void {
  const part = draft.parts.find(p => p.id === oldId);
  if (!part) throw new Error(`No part named ${oldId}.`);
  if (!validIdentifier(id) || id === "inputs" || id === "outputs") throw new Error("Choose an instance name such as carryGate.");
  if (draft.parts.some(p => p !== part && p.id === id)) throw new Error(`There is already a part named ${id}.`);
  const rename = (path: string) => path.startsWith(`${oldId}.`) ? id + path.slice(oldId.length) : path;
  part.id = id;
  draft.connections = draft.connections.map(w => ({ source: rename(w.source), destination: rename(w.destination) }));
}

export function exampleDraft(entries: readonly Entry[]): Draft {
  const standard = (name: string) => {
    const entry = entries.find((e) => e.group === "Standard" && e.exportName === name);
    if (!entry) throw new Error(`Missing standard component ${name}`);
    return entry.id;
  };
  return {
    name: "MyHalfAdder",
    inputs: ["a", "b"],
    outputs: ["sum", "carry"],
    parts: [
      { id: "myXor", entry: standard("XOR"), x: 300, y: 50 },
      { id: "myAnd", entry: standard("AND"), x: 300, y: 200 },
    ],
    connections: [
      { source: "inputs.a", destination: "myXor.inputs.a" },
      { source: "inputs.b", destination: "myXor.inputs.b" },
      { source: "inputs.a", destination: "myAnd.inputs.a" },
      { source: "inputs.b", destination: "myAnd.inputs.b" },
      { source: "myXor.outputs.out", destination: "outputs.sum" },
      { source: "myAnd.outputs.out", destination: "outputs.carry" },
    ],
  };
}

// A source is a circuit input (part === null) or the output of a part in placement order.
type Source = { part: number | null; pin: string };
type Wire = { pin: string; source: Source };
type Placed = { id: string; entry: Entry; inline: Wire[] };

/** Classify wires once: both the live circuit and printed circuit follow the same builder calls. */
function prepare(draft: Draft, entries: readonly Entry[]) {
  if (!validIdentifier(draft.name)) throw new Error(`Invalid chip name ${JSON.stringify(draft.name)} for a named export`);
  const byId = new Map<string, Entry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error(`Duplicate palette entry id ${JSON.stringify(entry.id)}`);
    byId.set(entry.id, entry);
  }
  const parts: Placed[] = draft.parts.map(({ id, entry: entryId }) => {
    const entry = byId.get(entryId);
    if (!entry) throw new Error(`Unknown palette entry ${JSON.stringify(entryId)} for part ${JSON.stringify(id)}`);
    return { id, entry, inline: [] };
  });

  const sources = new Map<string, Source>();
  const sinks = new Set<string>();
  for (const pin of draft.inputs) sources.set(`inputs.${pin}`, { part: null, pin });
  for (const pin of draft.outputs) sinks.add(`outputs.${pin}`);
  parts.forEach(({ id, entry }, part) => {
    for (const pin of entry.definition.outputs) sources.set(`${id}.outputs.${pin}`, { part, pin });
    for (const pin of entry.definition.inputs) sinks.add(`${id}.inputs.${pin}`);
  });

  const drivers = new Map<string, Source>();
  for (const { source, destination } of draft.connections) {
    const driver = sources.get(source);
    if (!driver) throw new Error(`Unknown source: ${source}`);
    if (!sinks.has(destination)) throw new Error(`Unknown destination: ${destination}`);
    if (drivers.has(destination)) throw new Error(`${destination} has multiple drivers`);
    drivers.set(destination, driver);
  }

  const feedback: (Wire & { part: number })[] = [];
  parts.forEach(({ id, entry, inline }, part) => {
    for (const pin of entry.definition.inputs) {
      const source = drivers.get(`${id}.inputs.${pin}`);
      if (!source) continue; // circuit() reports all unconnected pins together.
      if (source.part === null || source.part < part) inline.push({ pin, source });
      else feedback.push({ part, pin, source });
    }
  });
  const outputs: Wire[] = [];
  for (const pin of draft.outputs) {
    const source = drivers.get(`outputs.${pin}`);
    if (source) outputs.push({ pin, source });
  }

  const definition = circuit(draft, ({ inputs, add, feed, output }) => {
    const handles: ComponentInstance[] = [];
    const read = ({ part, pin }: Source): SourcePort => part === null ? inputs[pin]! : handles[part]!.outputs[pin]!;
    for (const { id, entry, inline } of parts) {
      handles.push(add(entry.definition, id, Object.fromEntries(inline.map(({ pin, source }) => [pin, read(source)]))));
    }
    for (const { part, pin, source } of feedback) feed(handles[part]!.inputs[pin]!, read(source));
    for (const { pin, source } of outputs) output(pin, read(source));
  });
  return { definition, parts, feedback, outputs };
}

export function compileDraft(draft: Draft, entries: readonly Entry[]): ComponentDefinition {
  return prepare(draft, entries).definition;
}

export function generateSource(draft: Draft, entries: readonly Entry[]): string {
  const { parts, feedback, outputs } = prepare(draft, entries);
  const usedNames = new Set([draft.name, "inputs", "add", "feed", "output"]);
  const localName = (preferred: string, fallback: string) => {
    const base = validIdentifier(preferred) ? preferred : fallback;
    let name = base;
    for (let n = 2; usedNames.has(name); n++) name = `${base}${n}`;
    usedNames.add(name);
    return name;
  };

  const imports = new Map<string, Map<string, string>>();
  function use(from: string, name: string): string {
    if (!from) throw new Error(`Missing import location for ${name}`);
    let bindings = imports.get(from);
    if (!bindings) {
      bindings = new Map();
      imports.set(from, bindings);
    }
    const existing = bindings.get(name);
    if (existing) return existing;
    const local = localName(name, "chip");
    bindings.set(name, local);
    return local;
  }
  const builder = use("@pbzona/wires", "circuit");
  const chips = parts.map(({ entry }) => use(entry.from, entry.exportName));
  const handles = parts.map(({ id }) => localName(id, "part"));
  const quote = (s: string) => JSON.stringify(s);
  const lines: string[] = [];
  for (const [from, bindings] of imports) {
    const names = Array.from(bindings, ([name, local]) => {
      if (name === local) return local;
      // Module export names needn't themselves be legal local variable names.
      const exported = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name);
      return `${exported} as ${local}`;
    });
    lines.push(`import { ${names.join(", ")} } from ${quote(from)};`);
  }

  // Emit a const for add() only if a wire needs that handle later.
  const referenced = new Set<number>();
  let usesInputs = false;
  const read = ({ part, pin }: Source) => {
    if (part === null) {
      usesInputs = true;
      return `inputs.${pin}`;
    }
    referenced.add(part);
    return `${handles[part]}.outputs.${pin}`;
  };
  const calls = parts.map(({ id, inline }, part) => ({
    start: `add(${chips[part]}, ${quote(id)}`,
    pins: inline.map(({ pin, source }) => `${pin}: ${read(source)}`),
  }));
  const later = feedback.map(({ part, pin, source }) => {
    referenced.add(part);
    return `feed(${handles[part]}.inputs.${pin}, ${read(source)});`;
  });
  const drive = outputs.map(({ pin, source }) => `output(${quote(pin)}, ${read(source)});`);
  const methods = [usesInputs && "inputs", calls.length && "add", later.length && "feed", drive.length && "output"].filter(Boolean);
  const list = (pins: string[]) => `[${pins.map(quote).join(", ")}]`;
  const compactSpec = `  { name: ${quote(draft.name)}, inputs: ${list(draft.inputs)}, outputs: ${list(draft.outputs)} },`;
  const portList = (key: "inputs" | "outputs") => {
    const line = `    ${key}: ${list(draft[key])},`;
    return line.length <= 100 ? [line] : [`    ${key}: [`, ...draft[key].map(pin => `      ${quote(pin)},`), "    ],"];
  };
  lines.push(
    "",
    `export const ${draft.name} = ${builder}(`,
    ...(compactSpec.length <= 100 ? [compactSpec] : ["  {", `    name: ${quote(draft.name)},`, ...portList("inputs"), ...portList("outputs"), "  },"]),
    `  (${methods.length ? `{ ${methods.join(", ")} }` : ""}) => {`,
    ...calls.flatMap(({ start, pins }, i) => {
      const prefix = `    ${referenced.has(i) ? `const ${handles[i]} = ` : ""}${start}`;
      const compact = `${prefix}${pins.length ? `, { ${pins.join(", ")} }` : ""});`;
      return !pins.length || compact.length <= 100 ? [compact] : [`${prefix}, {`, ...pins.map(pin => `      ${pin},`), "    });"];
    }),
    ...[...later, ...drive].map((call) => `    ${call}`),
    "  },",
    ");",
    "",
  );
  return lines.join("\n");
}
