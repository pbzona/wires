import { simulate, type Signal, type SimulationState } from "@pbzona/wires";
import { createBoard, type BoardScene } from "./canvas.js";
import { compileDraft, exampleDraft, generateSource, removePart, renamePart, validIdentifier, type Draft, type Entry } from "./model.js";
import { button, createPanel, text } from "./panel.js";
import { makeScene, type Inspection } from "./scene.js";

export type { Entry } from "./model.js";
export interface EditorOptions {
  entries: readonly Entry[];
  /** Omit on static hosts: copying the generated TypeScript still works. */
  save?: (name: string, source: string) => Promise<void>;
}
export interface Editor {
  setEntries(entries: readonly Entry[]): void;
  destroy(): void;
}

const gestureHint = "Connect two pins to wire them. Drag a part to move it; double-click to look inside.";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const blank = (): Draft => ({ name: "MyCircuit", inputs: ["a", "b"], outputs: ["out"], parts: [], connections: [] });

/** Mount one isolated editor. The host owns its library, stylesheet and file-save policy. */
export function mountEditor(host: HTMLElement, options: EditorOptions): Editor {
  const { root, el } = createPanel(host);
  const btn = (key: string) => el<HTMLButtonElement>(key);
  const input = (key: string) => el<HTMLInputElement>(key);
  const hint = (value: string) => { el("hint").textContent = value; };
  const wiring = el<HTMLDetailsElement>("wiring");
  const dialog = el<HTMLDialogElement>("dialog");
  let entries = options.entries;
  let library = new Map(entries.map(entry => [entry.id, entry]));
  const hasExample = ["XOR", "AND"].every(name => entries.some(e => e.group === "Standard" && e.exportName === name));
  let draft = hasExample ? exampleDraft(entries) : blank();
  let selected: string | null = null;
  let views: Inspection[] = [];
  let scene: BoardScene;
  let state: SimulationState | undefined;
  let signals: Readonly<Record<string, Signal>> = {};
  let driven: Record<string, Signal> = Object.create(null);
  let problem = "";
  let dialogMode: "new" | "edit" | "save" = "new";
  let destroyed = false;

  const canvas = el<HTMLCanvasElement>("canvas");
  const removeBtn = btn("removeBtn");
  const board = createBoard(canvas, {
    removeSelected,
    select(id) { selected = id; updateBoard(); renderInspector(); },
    move(id, x, y) {
      const part = draft.parts.find(p => p.id === id);
      if (views.length || !part) return;
      part.x = x; part.y = y;
      updateBoard(); // Moving a part changes only the drawing, never the simulator.
    },
    open: inspectPart,
    connect: wire,
    hint,
  });

  function updateBoard() {
    scene = makeScene(draft, library, views.at(-1), selected, signals);
    board.update(scene);
    removeBtn.hidden = !scene.editable;
    removeBtn.disabled = !scene.editable || selected === null;
    removeBtn.title = selected === null ? "Select a chip on the canvas to remove it" : `Remove ${selected} and its connected wires`;
    const n = scene.parts.length, w = scene.connections.length;
    el("count").textContent = `${n} ${n === 1 ? "part" : "parts"} · ${w} ${w === 1 ? "wire" : "wires"}`;
  }

  function rebuild() {
    views = [];
    // Back at the draft, so a part selected while looking inside another one no longer exists here.
    if (!draft.parts.some(p => p.id === selected)) selected = null;
    problem = "";
    driven = Object.assign(Object.create(null), Object.fromEntries(draft.inputs.map(name => [name, driven[name] ?? 0])));
    try {
      state = simulate(compileDraft(draft, entries), { maxTicks: 1024 }).set(driven);
    } catch (error) {
      state = undefined;
      problem = message(error);
    }
    el("title").textContent = draft.name;
    renderSimulation();
    renderCrumbs();
    renderInspector();
    renderSource();
    hint(gestureHint);
  }

  function renderSimulation() {
    // inspect() is a full snapshot. Read once per state change, never while panning or dragging.
    signals = state?.inspect().signals ?? {};
    updateBoard();
    el("tick").textContent = state ? `Tick ${state.tick} · ${state.stable ? "stable" : "pending"}` : "Not simulated";
    el("problem").textContent = problem;
    el("problem").hidden = !problem;
    btn("stepBtn").disabled = !state;
    btn("runBtn").disabled = !state || state.stable;
    btn("saveBtn").disabled = !state;
    btn("saveBtn").hidden = !options.save;
    const inputs = el("inputs"), outputs = el("outputs");
    inputs.replaceChildren(); outputs.replaceChildren();
    for (const name of draft.inputs) {
      const label = text("label", name); label.className = "we-pin";
      const drive = document.createElement("select");
      drive.setAttribute("aria-label", `Drive ${name}`);
      for (const value of ["0", "1", "X"]) drive.add(new Option(value, value));
      drive.value = String(driven[name]); drive.dataset.value = drive.value;
      drive.disabled = !state;
      drive.onchange = () => {
        if (!state) return;
        const value = drive.value === "X" ? "X" : drive.value === "1" ? 1 : 0;
        driven[name] = value;
        state = state.set({ [name]: value });
        problem = ""; renderSimulation();
        el("inputs").querySelector<HTMLSelectElement>(`[aria-label="Drive ${name}"]`)?.focus();
        hint("Inputs are queued. Step one tick or run until stable.");
      };
      label.append(drive); inputs.append(label);
    }
    for (const name of draft.outputs) {
      const label = text("span", name); label.className = "we-pin";
      const value = text("output", String(state?.read(name) ?? "—"));
      value.setAttribute("aria-label", `Output ${name}`); value.dataset.value = value.textContent;
      label.append(value); outputs.append(label);
    }
    if (!draft.inputs.length) inputs.append(text("small", "No inputs"));
    if (!draft.outputs.length) outputs.append(text("small", "No outputs"));
  }

  function advance(mode: "step" | "run") {
    if (!state) return;
    try {
      state = mode === "step" ? state.step() : state.run();
      problem = "";
      hint(state.stable ? `Settled at tick ${state.tick}. Change an input to try another case.` : `Tick ${state.tick}. More changes are pending.`);
    } catch (error) {
      problem = `${message(error)}\nShowing the state before ${mode}. Use Step to inspect it.`;
      hint("Simulation stopped. See the test bench for details.");
    }
    renderSimulation();
  }

  function wire(source: string, destination: string) {
    if (views.length) return;
    // Repatching a sink replaces its previous driver; fan-out at a source is unrestricted.
    draft.connections = draft.connections.filter(w => w.destination !== destination);
    if (source) draft.connections.push({ source, destination });
    rebuild();
    hint(source ? `${destination} ← ${source}` : `Disconnected ${destination}.`);
  }

  function removeSelected() {
    if (views.length || selected === null || !removePart(draft, selected)) return;
    const id = selected;
    selected = null; rebuild(); board.fit();
    hint(`Removed ${id} from the circuit.`);
    canvas.focus({ preventScroll: true });
  }

  function addPart(entry: Entry) {
    if (views.length) return;
    const name = entry.definition.name;
    const preferred = /[a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name.toLowerCase();
    const base = validIdentifier(preferred) ? preferred : "part";
    let id = base, i = 1;
    while (id === "inputs" || id === "outputs" || draft.parts.some(p => p.id === id) || !validIdentifier(id)) id = `${base}${++i}`;
    const last = draft.parts.at(-1);
    const y = last ? last.y + 110 + 27 * Math.max(library.get(last.entry)?.definition.inputs.length ?? 1,
      library.get(last.entry)?.definition.outputs.length ?? 1) : 60;
    draft.parts.push({ id, entry: entry.id, x: last?.x ?? 300, y });
    selected = id; rebuild(); board.fit();
    hint(`Placed ${id}. Connect its pins on the sheet or use Wiring and parts.`);
  }

  function renderPalette() {
    const palette = el("palette"); palette.replaceChildren();
    const filter = input("search").value.trim().toLowerCase();
    for (const group of ["Mine", "Examples", "Standard"] as const) {
      const matches = entries.filter(entry => entry.group === group && `${entry.definition.name} ${entry.exportName} ${entry.from}`.toLowerCase().includes(filter));
      if (!matches.length) continue;
      const section = document.createElement("section");
      const title = text("div", group); title.className = "we-group"; section.append(title);
      for (const entry of matches) {
        const part = button("", () => addPart(entry)); part.className = "we-part";
        part.disabled = views.length > 0;
        part.title = `Place ${entry.exportName} from ${entry.from}`;
        part.setAttribute("aria-label", `Add ${entry.exportName} (${group})`);
        const mark = text("span", entry.definition.kind === "primitive" ? "◇" : "▣"); mark.className = "we-glyph";
        part.append(mark, text("span", entry.exportName), text("span", "+")); section.append(part);
      }
      palette.append(section);
    }
    if (!palette.childElementCount) palette.append(text("span", "No matching chips."));
  }

  function inspectPart(id: string) {
    const parent = views.at(-1);
    let node = parent?.node.components.find(n => n.name === id);
    if (!parent) {
      const part = draft.parts.find(p => p.id === id);
      const def = part && library.get(part.entry)?.definition;
      if (def?.kind === "composite") node = def.describe();
    }
    if (!node || node.kind === "primitive") { hint("This is a primitive gate; there are no parts inside."); return; }
    views.push({ node, path: `${parent?.path ?? "root"}.${id}` });
    navigate();
  }
  function navigate() {
    selected = null; updateBoard(); board.fit(); renderCrumbs(); renderInspector(); renderPalette();
    hint(views.length ? "Inspecting a component. Use the breadcrumb to return to your draft." : gestureHint);
  }
  function renderCrumbs() {
    const crumbs = el("crumbs"); crumbs.replaceChildren();
    const labels = [draft.name, ...views.map(view => view.path.split(".").at(-1)!)];
    labels.forEach((label, index) => {
      if (index) crumbs.append(text("span", "/"));
      crumbs.append(index === labels.length - 1 ? text("strong", label) : button(label, () => {
        views = views.slice(0, index); navigate();
      }));
    });
  }

  function renderInspector() {
    if (!wiring.open) return;
    const box = el("inspector");
    // Re-rendering replaces every control. Remember which one had focus so keyboard users stay in place.
    const key = (node: Element) => node.getAttribute("aria-label") ?? node.textContent;
    const focused = document.activeElement && box.contains(document.activeElement) ? key(document.activeElement) : null;
    box.replaceChildren();
    fillInspector(box);
    if (focused !== null) [...box.querySelectorAll<HTMLElement>("select, input, button")].find(node => key(node) === focused)?.focus();
  }

  function fillInspector(box: HTMLElement) {
    const row = document.createElement("div"); row.className = "we-control";
    const pick = document.createElement("select"); pick.setAttribute("aria-label", "Select part");
    pick.add(new Option("Circuit interface", ""));
    scene.parts.forEach(p => pick.add(new Option(`${p.id} · ${p.label}`, p.id)));
    pick.value = selected ?? "";
    pick.onchange = () => { selected = pick.value || null; updateBoard(); renderInspector(); };
    row.append(pick);
    const part = scene.parts.find(p => p.id === selected);
    if (part?.composite) row.append(button("Look inside", () => inspectPart(part.id)));
    if (part && !views.length) row.append(button("Remove part", removeSelected));
    box.append(row);
    if (part && !views.length) {
      const field = document.createElement("input"); field.value = part.id; field.setAttribute("aria-label", "Instance name");
      const rename = button("Rename part", () => {
        try {
          const name = field.value.trim();
          if (name === part.id) return;
          renamePart(draft, part.id, name); selected = name; rebuild();
          hint(`Renamed ${part.id} to ${name}.`);
        } catch (error) { hint(message(error)); field.focus(); }
      });
      const group = document.createElement("div"); group.className = "we-control";
      group.append(field, rename); box.append(group);
    }
    const sinks = part ? part.inputs.map(name => `${part.id}.inputs.${name}`) : scene.outputs.map(name => `outputs.${name}`);
    const sources = [...scene.inputs.map(name => `inputs.${name}`), ...scene.parts.flatMap(p => p.outputs.map(name => `${p.id}.outputs.${name}`))];
    for (const sink of sinks) {
      const driver = scene.connections.find(w => w.destination === sink)?.source;
      const group = document.createElement("div"); group.className = "we-control";
      const label = text("label", `${sink} ← `);
      if (views.length) label.append(text("code", driver ?? "Unconnected"));
      else {
        const select = document.createElement("select"); select.setAttribute("aria-label", `Driver for ${sink}`);
        select.add(new Option("Unconnected", "")); sources.forEach(source => select.add(new Option(source, source)));
        select.value = driver ?? ""; select.onchange = () => wire(select.value, sink); label.append(select);
      }
      group.append(label); box.append(group);
    }
  }

  function renderSource() {
    if (el("drawer").hidden) return;
    try {
      if (!state) throw new Error(problem);
      el("code").textContent = generateSource(draft, entries); btn("copyBtn").disabled = false;
    } catch (error) { el("code").textContent = message(error); btn("copyBtn").disabled = true; }
  }
  function showDialog(mode: typeof dialogMode) {
    dialogMode = mode;
    const save = mode === "save", fresh = mode === "new";
    el("dialogTitle").textContent = save ? "Save as chip" : fresh ? "New circuit" : "Edit interface";
    el("explanation").textContent = save ? "Create a new TypeScript file in chips/. Existing files are never overwritten."
      : fresh ? "Start a blank circuit. This replaces the current canvas, not any saved chips. Separate port names with commas."
      : "Separate port names with commas. Removing a port also disconnects its wires.";
    input("nameInput").value = fresh ? "MyCircuit" : draft.name;
    input("inNames").value = fresh ? "a, b" : draft.inputs.join(", ");
    input("outNames").value = fresh ? "out" : draft.outputs.join(", ");
    el("portFields").hidden = save;
    btn("submitBtn").textContent = save ? "Create chip file" : fresh ? "Start circuit" : "Apply";
    el("dialogError").textContent = ""; dialog.showModal(); input("nameInput").select();
  }
  el<HTMLFormElement>("form").onsubmit = async event => {
    event.preventDefault();
    const name = input("nameInput").value.trim();
    try {
      if (!validIdentifier(name)) throw new Error("Choose a TypeScript identifier, such as MyAdder.");
      if (dialogMode === "save") {
        if (!state || !options.save) throw new Error("Complete the circuit before saving.");
        btn("submitBtn").disabled = true;
        btn("cancelBtn").disabled = true;
        await options.save(name, generateSource({ ...draft, name }, entries));
        if (destroyed) return;
        draft.name = name; el("title").textContent = name; renderCrumbs(); renderSource();
        hint(`Saved chips/${name}.ts.`);
      } else {
        const names = (key: string) => input(key).value.split(",").map(s => s.trim()).filter(Boolean);
        const inputs = names("inNames"), outputs = names("outNames"), all = [...inputs, ...outputs];
        if (all.some(n => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) || n === "__proto__") || new Set(all).size !== all.length) {
          throw new Error("Give every port a unique identifier, such as a, b, or carryOut.");
        }
        if (dialogMode === "new") { draft = blank(); driven = Object.create(null); }
        draft.name = name; draft.inputs = inputs; draft.outputs = outputs;
        draft.connections = draft.connections.filter(w => (!w.source.startsWith("inputs.") || inputs.includes(w.source.slice(7))) &&
          (!w.destination.startsWith("outputs.") || outputs.includes(w.destination.slice(8))));
        selected = null; rebuild(); board.fit(); renderPalette();
      }
      dialog.close();
    } catch (error) { el("dialogError").textContent = message(error); }
    finally { btn("submitBtn").disabled = false; btn("cancelBtn").disabled = false; }
  };

  dialog.oncancel = event => { if (btn("submitBtn").disabled) event.preventDefault(); };
  btn("newBtn").onclick = () => showDialog("new"); btn("editBtn").onclick = () => showDialog("edit");
  btn("saveBtn").onclick = () => showDialog("save"); btn("cancelBtn").onclick = () => dialog.close();
  btn("stepBtn").onclick = () => advance("step"); btn("runBtn").onclick = () => advance("run");
  removeBtn.onclick = removeSelected;
  btn("inBtn").onclick = () => board.zoom(1.25); btn("outBtn").onclick = () => board.zoom(0.8); btn("fitBtn").onclick = () => board.fit();
  btn("sourceBtn").onclick = () => {
    const drawer = el("drawer"); drawer.hidden = !drawer.hidden;
    btn("sourceBtn").setAttribute("aria-expanded", String(!drawer.hidden));
    if (!drawer.hidden) { renderSource(); drawer.scrollIntoView({ block: "nearest" }); }
  };
  btn("copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(el("code").textContent ?? ""); hint("TypeScript copied."); }
    catch { hint("Clipboard unavailable. Select and copy the source text instead."); el("code").focus(); }
  };
  input("search").oninput = renderPalette; wiring.ontoggle = renderInspector;
  rebuild(); renderPalette(); board.fit();
  return {
    setEntries(next) {
      const previous = library;
      entries = next; library = new Map(entries.map(entry => [entry.id, entry]));
      if (draft.parts.some(p => previous.get(p.entry)?.definition !== library.get(p.entry)?.definition)) rebuild();
      else renderSource();
      renderPalette();
    },
    destroy() { destroyed = true; board.destroy(); root.remove(); },
  };
}
