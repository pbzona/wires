// The template is static. Chip names, messages and generated source are always inserted as text.
export function createPanel(host: HTMLElement) {
  const root = document.createElement("section");
  root.className = "wires-editor";
  root.setAttribute("aria-label", "Circuit workbench");
  root.innerHTML = `
    <header class="we-mast"><div class="we-brand"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 34 34" fill="none"><rect width="34" height="34" rx="8" fill="currentColor"/><path d="M5 12h6m-6 10h6m0-14h5a9 9 0 0 1 0 18h-5zM27 17h3" stroke="white" stroke-width="2" stroke-linejoin="round"/><circle cx="25.5" cy="17" r="2.1" fill="white"/></svg><strong>wires</strong><span>/</span> Workbench</div><div class="we-actions"><button data-el="newBtn">New circuit</button><button data-el="sourceBtn" aria-expanded="false">&lt;/&gt; Source</button><button data-el="saveBtn" class="we-primary">Save as chip</button></div></header>
    <div class="we-body">
      <aside class="we-library"><div class="we-kicker">Parts drawer</div><h2>Library</h2><input data-el="search" type="search" autocomplete="off" aria-label="Search library" placeholder="Search chips…"><div data-el="palette" class="we-palette"></div><small class="we-library-note">Export a chip in <code>chips/</code> to add it to your library.</small></aside>
      <main class="we-work"><div class="we-sheet-head"><div><div class="we-kicker">Logic workbench</div><h1 data-el="title"></h1></div><button data-el="editBtn">Edit interface</button></div>
        <div class="we-board-head"><nav data-el="crumbs" aria-label="Circuit hierarchy"></nav><div class="we-zoom"><button data-el="outBtn" aria-label="Zoom out">−</button><button data-el="fitBtn" aria-label="Fit circuit to view">Fit</button><button data-el="inBtn" aria-label="Zoom in">+</button></div></div>
        <div class="we-sheet"><canvas data-el="canvas" tabindex="0" aria-label="Circuit schematic. Use Wiring and parts below for keyboard controls.">Circuit drawing. Wiring and parts below lists the same connections.</canvas></div>
        <div class="we-caption"><span data-el="hint" role="status"></span><span data-el="count"></span></div>
        <section class="we-bench" aria-label="Test bench"><div class="we-bench-head"><div><span class="we-kicker">Simulation</span><h2>Test bench</h2></div><div class="we-actions"><span data-el="tick" class="we-stamp"></span><button data-el="stepBtn">Step</button><button data-el="runBtn" class="we-dark">Run to stable</button></div></div>
          <p data-el="problem" class="we-problem" role="status" hidden></p><div class="we-io"><div><h3>Drive inputs</h3><div data-el="inputs" class="we-pins"></div></div><div><h3>Read outputs</h3><div data-el="outputs" class="we-pins"></div></div></div>
        </section>
        <details data-el="wiring" class="we-wiring"><summary>Wiring and parts</summary><div data-el="inspector"></div></details>
        <section data-el="drawer" class="we-source" hidden><div class="we-bench-head"><h2>TypeScript source</h2><button data-el="copyBtn">Copy TypeScript</button></div><pre data-el="code" tabindex="0"></pre></section>
      </main>
    </div>
    <dialog data-el="dialog"><form data-el="form"><div class="we-kicker">Circuit file</div><h2 data-el="dialogTitle"></h2><p data-el="explanation"></p><label>Chip name<input data-el="nameInput" required autocomplete="off" spellcheck="false"></label><div data-el="portFields"><label>Inputs<input data-el="inNames" placeholder="a, b" autocomplete="off"></label><label>Outputs<input data-el="outNames" placeholder="out" autocomplete="off"></label></div><small data-el="dialogError" role="alert"></small><div class="we-actions"><button type="button" data-el="cancelBtn">Cancel</button><button data-el="submitBtn" class="we-primary" type="submit"></button></div></form></dialog>`;
  host.append(root);
  function el<T extends HTMLElement>(key: string) { return root.querySelector<T>(`[data-el="${key}"]`)!; }
  return { root, el };
}

export function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}
export function button(label: string, action: () => void) {
  const el = text("button", label);
  el.type = "button";
  el.onclick = action;
  return el;
}
