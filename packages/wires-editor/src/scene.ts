import type { ComponentDescription, Signal } from "@pbzona/wires";
import type { BoardScene } from "./canvas.js";
import type { Draft, Entry } from "./model.js";

export type Inspection = { node: ComponentDescription; path: string };

/** Only the open level gets screen coordinates. Hidden gates never become canvas nodes. */
export function makeScene(draft: Draft, library: ReadonlyMap<string, Entry>, view: Inspection | undefined,
  selected: string | null, signals: Readonly<Record<string, Signal>>): BoardScene {
  const prefix = view?.path ?? "root";
  const node = view?.node;
  const inputs = node ? ports(node, "input") : draft.inputs;
  const outputs = node ? ports(node, "output") : draft.outputs;
  let parts: BoardScene["parts"];
  if (node) {
    // Lay out the immediate children in columns, leaving space for wide chips' pins.
    const rows = Math.ceil(Math.sqrt(node.components.length));
    let y = 40;
    parts = node.components.map((child, index) => {
      if (index % rows === 0) y = 40;
      const part = { id: child.name, label: child.definition, inputs: ports(child, "input"),
        outputs: ports(child, "output"), composite: child.kind === "composite",
        x: 270 + 290 * Math.floor(index / rows), y };
      y += 120 + 30 * Math.max(part.inputs.length, part.outputs.length);
      return part;
    });
  } else {
    parts = draft.parts.map(part => {
      const def = library.get(part.entry)?.definition;
      return { id: part.id, x: part.x, y: part.y, label: def?.name ?? "Missing chip",
        inputs: def?.inputs ?? [], outputs: def?.outputs ?? [], composite: def?.kind === "composite" };
    });
  }
  const connections = node ? node.connections.map(wire => ({ source: wire.source.slice(node.id.length + 1),
    destination: wire.destination.slice(node.id.length + 1) })) : draft.connections;
  const visible: Record<string, Signal> = Object.create(null);
  function expose(port: string) {
    const value = signals[`${prefix}.${port}`];
    if (value !== undefined) visible[port] = value;
  }
  inputs.forEach(name => expose(`inputs.${name}`));
  outputs.forEach(name => expose(`outputs.${name}`));
  for (const part of parts) {
    part.inputs.forEach(name => expose(`${part.id}.inputs.${name}`));
    part.outputs.forEach(name => expose(`${part.id}.outputs.${name}`));
  }
  return { inputs, outputs, parts, connections, signals: visible, selected, editable: !node };
}

function ports(node: ComponentDescription, direction: "input" | "output") {
  return node.ports.filter(port => port.direction === direction).map(port => port.name);
}
