import { mountEditor, type Entry } from "@pbzona/wires-editor";
import "@pbzona/wires-editor/style.css";
import "./style.css";
import { entries } from "./palette.ts";

async function save(name: string, source: string): Promise<void> {
  const response = await fetch("/__wires/save", {
    method: "POST",
    mode: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, source }),
  });
  if (!response.ok) throw new Error(await response.text() || `Save failed (${response.status}).`);
}

const host = document.querySelector<HTMLElement>("#workbench")!;
const localDev = import.meta.env.DEV && import.meta.hot && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const editor = mountEditor(host, { entries, ...(localDev ? { save } : {}) });

// Refresh the palette, not the editor: a chip can change while you're wiring a draft.
if (import.meta.hot) {
  import.meta.hot.accept("./palette.ts", updated => {
    if (updated) editor.setEntries(updated.entries as Entry[]);
  });
  import.meta.hot.dispose(() => editor.destroy());
}
