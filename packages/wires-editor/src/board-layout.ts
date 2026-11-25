import type { BoardScene } from "./canvas.js";

export type Point = { x: number; y: number };
export type Box = Point & { w: number; h: number };
export type Pin = Point & {
  path: string; name: string; source: boolean; index: number; bottom: number;
};
export type Chip = Box & { part: BoardScene["parts"][number]; pins: Pin[] };
export type Terminal = Box & { pin: Pin };
export type Trace = { from: Pin; to: Pin; points: Point[]; box: Box };

export function contains(box: Box, p: Point, pad = 0) {
  return p.x >= box.x - pad && p.y >= box.y - pad &&
    p.x <= box.x + box.w + pad && p.y <= box.y + box.h + pad;
}

export function overlaps(a: Box, b: Box) {
  return a.x <= b.x + b.w && a.y <= b.y + b.h && b.x <= a.x + a.w && b.y <= a.y + a.h;
}

function extent(boxes: readonly Box[]): Box {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const box of boxes) {
    x = Math.min(x, box.x); y = Math.min(y, box.y);
    right = Math.max(right, box.x + box.w); bottom = Math.max(bottom, box.y + box.h);
  }
  return boxes.length ? { x, y, w: right - x, h: bottom - y } : { x: 300, y: 50, w: 182, h: 120 };
}

function route(from: Pin, to: Pin): Trace {
  // Give parallel signals separate tracks, but keep branches from the same driver together.
  const track = from.index % 5;
  let points: Point[];
  if (to.x - from.x > 48) {
    const mid = (from.x + to.x) / 2 + (track - 1) * 8;
    points = [from, { x: mid, y: from.y }, { x: mid, y: to.y }, to];
  } else {
    // Feedback leaves the right edge, loops below both chips, and enters on the left.
    const x1 = from.x + 20 + track * 6, x2 = to.x - 20 - to.index % 5 * 6;
    const y = Math.max(from.bottom, to.bottom) + 22 + track * 8;
    points = [from, { x: x1, y: from.y }, { x: x1, y }, { x: x2, y }, { x: x2, y: to.y }, to];
  }
  return { from, to, points, box: extent(points.map(p => ({ ...p, w: 0, h: 0 }))) };
}

function longest(names: readonly string[]) {
  return names.reduce((n, s) => Math.max(n, s.length), 0);
}

/** Only the scene's immediate children are laid out. Positions and paths are in world units. */
export function layout(scene: BoardScene, moved?: { id: string } & Point) {
  const pins = new Map<string, Pin>();
  const chips: Chip[] = scene.parts.map(part => {
    const { x, y } = moved?.id === part.id ? moved : part;
    const w = Math.min(420, Math.max(180, 72 + part.label.length * 9, 72 + part.id.length * 7,
      84 + 2 * Math.max(longest(part.inputs), longest(part.outputs)) * 7));
    const rows = Math.max(1, part.inputs.length, part.outputs.length);
    const h = 62 + rows * 26;
    const chip: Chip = { part, x, y, w, h, pins: [] };
    for (const side of ["inputs", "outputs"] as const) {
      const source = side === "outputs";
      part[side].forEach((name, index) => {
        const path = `${part.id}.${side}.${name}`;
        const pin = { name, path, source, index, bottom: y + h, x: x + (source ? w : 0),
          y: y + 66 + 26 * (index + (rows - part[side].length) / 2) };
        pins.set(path, pin); chip.pins.push(pin);
      });
    }
    return chip;
  });
  const body = extent(chips);
  const terminals: Terminal[] = [];
  const headings: (Point & { label: string })[] = [];
  for (const side of ["inputs", "outputs"] as const) {
    const names = scene[side], source = side === "inputs";
    if (!names.length) continue;
    const w = Math.min(220, Math.max(92, 52 + longest(names) * 8));
    const x = source ? body.x - 106 - w : body.x + body.w + 106;
    const firstY = body.y + body.h / 2 - (names.length - 1) * 26 - 16;
    headings.push({ label: source ? "INPUTS" : "OUTPUTS", x, y: firstY - 15 });
    names.forEach((name, index) => {
      const y = firstY + index * 52, path = `${side}.${name}`;
      const pin = { name, path, source, index, bottom: y + 32, x: x + (source ? w : 0), y: y + 16 };
      pins.set(path, pin); terminals.push({ x, y, w, h: 32, pin });
    });
  }
  const traces: Trace[] = [], drivers = new Map<string, string>();
  for (const { source, destination } of scene.connections) {
    const from = pins.get(source), to = pins.get(destination);
    if (from && to) {
      traces.push(route(from, to)); drivers.set(destination, source);
    }
  }
  const bounds = extent([...chips, ...terminals, ...traces.map(t => t.box),
    ...headings.map(p => ({ x: p.x, y: p.y - 7, w: 52, h: 14 }))]);
  return { chips, pins, terminals, headings, traces, drivers, bounds };
}

/** Trace segments are axis-aligned; include a small tolerance for their rounded elbows. */
export function hitsTrace(trace: Trace, p: Point, pad: number) {
  if (!contains(trace.box, p, pad)) return false;
  return trace.points.some((a, i, line) => {
    const b = line[i + 1];
    return b && contains({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, p, pad);
  });
}
