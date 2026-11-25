# @pbzona/wires-editor

A canvas workbench for building and inspecting circuits. Start with `npm create @pbzona/wires` for a Vite app, or install the editor and its simulator together with `npm install @pbzona/wires-editor @pbzona/wires`. No React dependency or Vite plugin is required for rendering. This example assumes a `<div id="workbench"></div>` and a bundler that handles CSS imports (the starter includes Vite's CSS declarations).

```ts
import { mountEditor, type Entry } from "@pbzona/wires-editor";
import "@pbzona/wires-editor/style.css";
import * as standard from "@pbzona/wires/components";

const entries: Entry[] = Object.entries(standard).map(([name, definition]) => ({
  id: `standard/${name}`, group: "Standard", exportName: name, definition,
  from: "@pbzona/wires/components",
}));
const editor = mountEditor(document.getElementById("workbench")!, { entries });
// editor.setEntries(nextEntries) updates the palette without replacing the draft.
// editor.destroy() removes the editor and releases pointer/resize listeners.
```

`id` identifies a palette entry independently of its display or export name. `from` is the module specifier **relative to the file you will save**. For example, a saved chip in `chips/` can import `Adder4` from `../examples/Adder4.ts`. The host and editor must use the same installation of `@pbzona/wires`; it is a peer dependency. In React, mount on a ref in an effect and return `editor.destroy` as cleanup.

## Using the sheet

- The opening half adder uses XOR and AND from the standard library. Without those entries, the editor starts a blank draft instead.
- Choose **New circuit** to start over, or **Edit interface** to name ports. Click a library entry to place it. Click a source and a destination pin to connect them. Reconnecting a destination replaces its wire. **Wiring and parts** offers the same connections with labeled controls, including disconnect and remove. Select a part there to rename it (for example, `carryGate`); the generated source uses that instance name.
- Click a chip's header on the canvas and choose **Remove chip**, or press **Delete** or **Backspace** with the canvas focused. This removes the instance and its attached wires, not the chip definition in the library.
- Drag a part to move it, drag the background to pan, and use the scroll wheel or zoom controls to magnify. Double-click a composite to inspect one level; return using the breadcrumb. Its inner wiring is read-only.
- **Drive inputs** queues input changes. **Step** advances one real simulator tick; **Run to stable** stops on stabilization or reports a 1,024-tick limit. The board shows actual `0`, `1`, or `X` values. A dash means no simulation is available, not an unknown signal. Editing topology starts a fresh simulation; moving parts does not.
- **Source** shows the TypeScript for the root draft. The editor never parses or rewrites an existing chip. Canvas layout and unfinished drafts are not persisted; copy or save a complete chip before reloading.

## Saving

Pass an optional `save(name, source): Promise<void>` when mounting to enable **Save as chip**. Resolve only after successfully creating a new file; reject with a useful error on collision. After discovery, call `setEntries` to offer the new chip. The scaffold handles this on the loopback Vite dev server. Without a save handler the editor remains fully usable with **Copy TypeScript**.

Drawing uses Canvas 2D at the current hierarchy level. Panning doesn't rebuild a circuit or step the simulator. Simulation still elaborates all underlying gates; rendering a chip as a single block does not make large memories inexpensive to simulate.
