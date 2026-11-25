import * as chips from "@pbzona/wires/components";
import { mountEditor, type Entry } from "@pbzona/wires-editor";
import "@pbzona/wires-editor/style.css";
import "./demo.css";

const entries: Entry[] = Object.entries(chips).map(([exportName, definition]) => ({
  id: `standard/${exportName}`,
  group: "Standard",
  from: "@pbzona/wires/components",
  exportName,
  definition,
}));

// No save handler: the draft lives on the page, and Source still offers Copy TypeScript.
const editor = mountEditor(document.querySelector<HTMLElement>("#workbench")!, { entries });
if (import.meta.hot) import.meta.hot.dispose(() => editor.destroy());
