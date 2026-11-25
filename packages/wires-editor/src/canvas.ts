import type { Signal } from "@pbzona/wires";
import { contains, hitsTrace, layout, overlaps, type Box, type Chip, type Pin, type Point, type Trace } from "./board-layout.js";

export type BoardScene = {
  inputs: string[];
  outputs: string[];
  parts: {
    id: string; label: string; inputs: readonly string[]; outputs: readonly string[];
    x: number; y: number; composite: boolean;
  }[];
  connections: { source: string; destination: string }[];
  signals: Readonly<Record<string, Signal>>;
  selected: string | null;
  editable: boolean;
};

type Callbacks = {
  select(id: string | null): void;
  move(id: string, x: number, y: number): void;
  connect(source: string, destination: string): void;
  open(id: string): void;
  hint(message: string): void;
};

type Hit = { kind: "pin"; pin: Pin } | { kind: "chip"; chip: Chip } | { kind: "trace"; trace: Trace };
type Gesture = {
  id: number; start: Point; origin: Point; hit: Hit | null;
  middle: boolean; dragged: boolean; moved?: { id: string } & Point;
};

const paper = "#faf9f5", face = "#fffefa", ink = "#23352e", muted = "#617068", accent = "#087761";
const sans = 'system-ui, sans-serif', mono = 'ui-monospace, SFMono-Regular, Consolas, monospace';
const styles = {
  0: { stroke: "#859189", text: "#49574e", tint: "#eaf0e9", dash: [] },
  1: { stroke: "#09806a", text: "#056451", tint: "#d9f1e6", dash: [] },
  X: { stroke: "#ad7925", text: "#865b17", tint: "#f9edce", dash: [6, 4] },
  absent: { stroke: "#a3a69a", text: "#626b63", tint: "#f0f0e9", dash: [2, 4] },
};

/** The host owns the scene. A pointer gesture may preview a layout, but only a completed edit calls back. */
export function createBoard(canvas: HTMLCanvasElement, callbacks: Callbacks) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The circuit board requires a 2D canvas.");
  const g = context;
  let scene: BoardScene = { inputs: [], outputs: [], parts: [], connections: [], signals: {}, selected: null, editable: false };
  let drawing = layout(scene);
  let width = 0, height = 0, scale = 1, tx = 0, ty = 0;
  let needsFit = true, frame = 0, destroyed = false;
  let pointer: Point | null = null, hover: Hit | null = null, gesture: Gesture | null = null;
  let pending: string | null = null, selectedTrace: string | null = null;
  const oldTouchAction = canvas.style.touchAction, oldCursor = canvas.style.cursor;
  canvas.style.touchAction = "none";

  function invalidate() {
    if (!frame && !destroyed) frame = requestAnimationFrame(paint);
  }

  function world(p: Point): Point { return { x: (p.x - tx) / scale, y: (p.y - ty) / scale }; }
  function local(e: MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function fitScale() {
    const { w, h } = drawing.bounds;
    const pad = Math.min(44, width * .08, height * .08);
    return Math.min(1.3, (width - 2 * pad) / Math.max(1, w), (height - 2 * pad) / Math.max(1, h));
  }
  function center() {
    const b = drawing.bounds;
    scale = fitScale(); tx = width / 2 - (b.x + b.w / 2) * scale; ty = height / 2 - (b.y + b.h / 2) * scale;
    needsFit = false;
  }
  function fit() { needsFit = true; invalidate(); }
  function zoomAt(factor: number, pivot: Point) {
    if (!Number.isFinite(factor) || factor <= 0 || !width || !height) return;
    const anchor = world(pivot);
    scale = Math.min(4, Math.max(Math.min(.12, fitScale()), scale * factor));
    tx = pivot.x - anchor.x * scale; ty = pivot.y - anchor.y * scale;
    refreshHover(); invalidate();
  }

  function box(x: number, y: number, w: number, h: number, radius: number, fill: string, stroke?: string, thickness = 1) {
    g.beginPath(); g.roundRect(x, y, w, h, radius); g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = thickness; g.stroke(); }
  }
  function text(label: string, x: number, y: number, font: string, color: string,
    align: CanvasTextAlign = "left", max = Infinity) {
    g.font = font; g.fillStyle = color; g.textAlign = align;
    if (max !== Infinity && g.measureText(label).width > max) {
      // Do not compress long identifiers into unreadable narrow glyphs.
      let n = Math.min(label.length, Math.ceil(max / 5));
      while (n && g.measureText(label.slice(0, n) + "…").width > max) n--;
      label = label.slice(0, n) + "…";
    }
    g.fillText(label, x, y);
  }
  function circle(x: number, y: number, r: number, fill: string, stroke: string, w: number) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
    g.strokeStyle = stroke; g.lineWidth = w; g.stroke();
  }
  function path(points: Point[]) {
    const start = points[0];
    if (!start) return;
    g.beginPath(); g.moveTo(start.x, start.y);
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
      const r = Math.min(7, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
      g.arcTo(b.x, b.y, c.x, c.y, r);
    }
    const end = points[points.length - 1]!;
    g.lineTo(end.x, end.y);
  }
  function value(pin: Pin): Signal | undefined {
    const driver = drawing.drivers.get(pin.path);
    return scene.signals[pin.path] ?? (driver ? scene.signals[driver] : undefined);
  }
  function drawTrace(t: Trace, active: boolean) {
    const state = styles[value(t.from) ?? "absent"];
    path(t.points);
    g.lineWidth = active ? 8 : 5; g.strokeStyle = active ? "#b3dbc9" : paper; g.stroke();
    g.lineWidth = active ? 3 : 2; g.strokeStyle = state.stroke; g.setLineDash(state.dash); g.stroke(); g.setLineDash([]);
  }
  function drawPin(pin: Pin, badgeX: number) {
    const v = value(pin), state = styles[v ?? "absent"];
    const active = pending === pin.path || (hover?.kind === "pin" && hover.pin.path === pin.path);
    const anchor = pending && drawing.pins.get(pending);
    const eligible = anchor && anchor.source !== pin.source;
    if (active || eligible) circle(pin.x, pin.y, active ? 9 : 7.5, "#e4f4e9", active ? accent : "#91bdab", active ? 1.7 : 1);
    circle(pin.x, pin.y, 4.3, v === 1 ? state.stroke : face, state.stroke, 2);
    if (scale < .32) return;
    box(badgeX - 9, pin.y - 8, 18, 16, 4, state.tint);
    text(v === undefined ? "–" : String(v), badgeX, pin.y + .5, `600 11px ${mono}`, state.text, "center");
  }
  function drawChip(c: Chip, view: Box) {
    const { part, x, y, w, h } = c, selected = scene.selected === part.id || gesture?.moved?.id === part.id;
    const over = hover?.kind === "chip" && hover.chip.part.id === part.id;
    if (selected) box(x - 4, y - 4, w + 8, h + 8, 10, "#c9e6d8");
    box(x, y + 2.5, w, h, 7, "#dee1d7");
    box(x, y, w, h, 7, face, selected ? accent : over ? ink : "#7c887e", selected ? 2 : 1.25);
    if (scale < .20) return;
    // A chip pictogram, not a logic symbol: leaves can be arbitrary primitive gates.
    box(x + 12, y + 12, 27, 27, 6, part.composite ? "#e4efe5" : "#f0efe6");
    const gx = x + 20, gy = y + 20;
    g.strokeStyle = part.composite ? accent : muted; g.lineWidth = 1.5;
    g.strokeRect(gx, gy, 11, 11); g.beginPath();
    for (const dy of [3, 8]) { g.moveTo(gx - 3, gy + dy); g.lineTo(gx, gy + dy); g.moveTo(gx + 11, gy + dy); g.lineTo(gx + 14, gy + dy); }
    g.stroke();
    text(part.label, x + 49, y + 18, `650 15px ${sans}`, ink, "left", w - 73);
    text(part.id, x + 49, y + 35, `11px ${mono}`, muted, "left", w - 60);
    if (part.composite) text("›", x + w - 14, y + 22, `18px ${sans}`, muted, "center");
    g.fillStyle = "#e2e5db"; g.fillRect(x + 1, y + 49, w - 2, 1);
    for (const pin of c.pins) {
      if (pin.y < view.y - 9 || pin.y > view.y + view.h + 9) continue;
      const direction = pin.source ? -1 : 1;
      drawPin(pin, pin.x + direction * 19);
      if (scale >= .32) text(pin.name, pin.x + direction * 34, pin.y, `12px ${mono}`, ink,
        pin.source ? "right" : "left", w / 2 - 38);
    }
  }
  function drawGrid() {
    let step = 20 * scale;
    while (step < 13) step *= 2;
    g.fillStyle = "#d5d9ce";
    for (let x = tx % step; x < width; x += step) {
      for (let y = ty % step; y < height; y += step) g.fillRect(x - .65, y - .65, 1.3, 1.3);
    }
  }
  function paint() {
    frame = 0;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    tx += (rect.width - width) / 2; ty += (rect.height - height) / 2;
    width = rect.width; height = rect.height;
    const dpr = window.devicePixelRatio || 1, w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (needsFit && drawing.pins.size + drawing.chips.length > 0) center();
    g.setTransform(w / width, 0, 0, h / height, 0, 0);
    g.fillStyle = paper; g.fillRect(0, 0, width, height); drawGrid();
    g.translate(tx, ty); g.scale(scale, scale); g.textBaseline = "middle"; g.lineCap = "round"; g.lineJoin = "round";
    const top = world({ x: -12, y: -12 }), view = { ...top, w: (width + 24) / scale, h: (height + 24) / scale };
    const focused = hover?.kind === "trace" ? hover.trace.to.path : selectedTrace;
    let highlighted: Trace | undefined;
    for (const t of drawing.traces) {
      if (!overlaps(view, t.box)) continue;
      if (t.to.path === focused) highlighted = t; else drawTrace(t, false);
    }
    if (highlighted) drawTrace(highlighted, true);
    const anchor = pending && drawing.pins.get(pending);
    if (anchor && pointer) {
      const end = hover?.kind === "pin" && hover.pin.source !== anchor.source ? hover.pin : world(pointer);
      const mid = (anchor.x + end.x) / 2;
      path([anchor, { x: mid, y: anchor.y }, { x: mid, y: end.y }, end]);
      g.strokeStyle = accent; g.lineWidth = 2; g.setLineDash([4, 5]); g.stroke(); g.setLineDash([]);
    }
    for (const c of drawing.chips) if (overlaps(view, c)) drawChip(c, view);
    for (const t of drawing.terminals) {
      if (!overlaps(view, t)) continue;
      box(t.x, t.y, t.w, t.h, 6, face, "#a9b3a7");
      const { pin } = t, badgeX = pin.source ? t.x + t.w - 18 : t.x + 18;
      drawPin(pin, badgeX);
      if (scale >= .32) text(pin.name, pin.source ? t.x + 12 : t.x + t.w - 12, pin.y,
        `600 13px ${mono}`, ink, pin.source ? "left" : "right", t.w - 44);
    }
    if (scale >= .32) for (const p of drawing.headings) {
      if (overlaps(view, { x: p.x, y: p.y - 8, w: 60, h: 16 })) text(p.label, p.x, p.y, `600 10px ${mono}`, muted);
    }
  }

  function hit(screen: Point): Hit | null {
    const p = world(screen), pad = Math.min(14, Math.max(7, 9 / scale));
    for (const t of drawing.terminals) if (contains(t, p, pad)) return { kind: "pin", pin: t.pin };
    // Reverse paint order so the topmost part wins in an overlap. Labels and badges are pin targets too.
    for (let i = drawing.chips.length - 1; i >= 0; i--) {
      const chip = drawing.chips[i]!;
      if (!contains(chip, p, pad)) continue;
      for (const pin of chip.pins) {
        const inward = (p.x - pin.x) * (pin.source ? -1 : 1);
        if (Math.abs(p.y - pin.y) <= Math.max(11, pad) && inward >= -pad && inward < chip.w / 2 - 4) return { kind: "pin", pin };
      }
      if (contains(chip, p)) return { kind: "chip", chip };
    }
    for (const trace of drawing.traces) if (hitsTrace(trace, p, Math.min(12, 5 / scale))) return { kind: "trace", trace };
    return null;
  }
  function refreshHover() {
    hover = pointer && !gesture ? hit(pointer) : null;
    canvas.style.cursor = gesture?.dragged ? "grabbing" : hover?.kind === "pin" && scene.editable ? "crosshair" :
      hover?.kind === "chip" || hover?.kind === "trace" || hover?.kind === "pin" ? "pointer" : "grab";
  }
  function choosePin(pin: Pin) {
    const v = value(pin), describe = `${pin.path}: ${v ?? "no signal"}`;
    if (!scene.editable) { callbacks.hint(describe); return; }
    const first = pending && drawing.pins.get(pending);
    if (first && first.path === pin.path) { pending = null; callbacks.hint("Connection cancelled."); return; }
    if (first && first.source !== pin.source) {
      pending = null; callbacks.connect(first.source ? first.path : pin.path, first.source ? pin.path : first.path); return;
    }
    pending = pin.path;
    callbacks.hint(`${describe} · Choose a ${pin.source ? "destination" : "source"} port.`);
  }
  function click(target: Hit | null) {
    selectedTrace = null;
    if (target?.kind === "pin") { choosePin(target.pin); return; }
    if (pending) { pending = null; callbacks.hint("Connection cancelled."); }
    if (target?.kind === "trace") {
      selectedTrace = target.trace.to.path;
      callbacks.hint(`${target.trace.from.path} → ${target.trace.to.path}: ${value(target.trace.from) ?? "no signal"}`);
    }
    callbacks.select(target?.kind === "chip" ? target.chip.part.id : null);
  }

  const listeners = new AbortController(), options = { signal: listeners.signal };
  canvas.addEventListener("pointerdown", e => {
    if (gesture || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault(); pointer = local(e);
    gesture = { id: e.pointerId, start: pointer, origin: { x: tx, y: ty }, hit: hit(pointer), middle: e.button === 1, dragged: false };
    canvas.setPointerCapture(e.pointerId);
  }, options);
  canvas.addEventListener("pointermove", e => {
    if (gesture && gesture.id !== e.pointerId) return;
    pointer = local(e);
    if (gesture) {
      const dx = pointer.x - gesture.start.x, dy = pointer.y - gesture.start.y;
      if (!gesture.dragged && Math.hypot(dx, dy) < 4) return;
      gesture.dragged = true;
      const target = gesture.hit;
      if (!gesture.middle && target?.kind === "chip" && scene.editable) {
        gesture.moved = { id: target.chip.part.id, x: Math.round(target.chip.x + dx / scale), y: Math.round(target.chip.y + dy / scale) };
        drawing = layout(scene, gesture.moved);
      } else { tx = gesture.origin.x + dx; ty = gesture.origin.y + dy; }
    }
    refreshHover(); invalidate();
  }, options);
  function finish(e: PointerEvent, cancelled: boolean) {
    if (!gesture || gesture.id !== e.pointerId) return;
    const done = gesture; gesture = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (done.moved) {
      drawing = layout(scene);
      if (!cancelled && scene.editable) {
        callbacks.select(done.moved.id); callbacks.move(done.moved.id, done.moved.x, done.moved.y);
      }
    } else if (!cancelled && !done.dragged && !done.middle) click(done.hit);
    pointer = cancelled || e.pointerType === "touch" ? null : local(e);
    refreshHover(); invalidate();
  }
  canvas.addEventListener("pointerup", e => finish(e, false), options);
  canvas.addEventListener("pointercancel", e => finish(e, true), options);
  canvas.addEventListener("lostpointercapture", e => finish(e, true), options);
  canvas.addEventListener("pointerleave", () => {
    if (!gesture) { pointer = null; refreshHover(); invalidate(); }
  }, options);
  canvas.addEventListener("dblclick", e => {
    const target = hit(local(e));
    if (e.button === 0 && target?.kind === "chip" && target.chip.part.composite) {
      pending = null; selectedTrace = null; callbacks.open(target.chip.part.id); invalidate();
    }
  }, options);
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    if (gesture) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    pointer = local(e); zoomAt(Math.exp(-Math.max(-230, Math.min(230, e.deltaY * unit)) * .0025), pointer);
  }, { ...options, passive: false });

  const observer = new ResizeObserver(invalidate);
  observer.observe(canvas);
  window.addEventListener("resize", invalidate, options);
  // A screen change can alter DPR without changing the canvas's CSS dimensions.
  function watchDpr() {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => {
      invalidate(); watchDpr();
    }, { ...options, once: true });
  }
  watchDpr(); invalidate();

  return {
    update(next: BoardScene) {
      scene = next; drawing = layout(scene, gesture?.moved);
      if (!scene.editable || (pending && !drawing.pins.has(pending))) pending = null;
      if (selectedTrace && !drawing.drivers.has(selectedTrace)) selectedTrace = null;
      refreshHover(); invalidate();
    },
    fit,
    zoom(factor: number) { zoomAt(factor, { x: width / 2, y: height / 2 }); },
    destroy() {
      destroyed = true; listeners.abort(); observer.disconnect(); cancelAnimationFrame(frame);
      if (gesture && canvas.hasPointerCapture(gesture.id)) canvas.releasePointerCapture(gesture.id);
      canvas.style.cursor = oldCursor; canvas.style.touchAction = oldTouchAction;
    },
  };
}
