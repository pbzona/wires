# wires

A TypeScript toolkit for **learning** how digital logic works, by building it
yourself from a single NAND gate up to adders and memory, then simulating it
and looking inside.

## Who this is for

`wires` is a learning tool for people. It exists so you can understand how
computation is built from very simple parts, writing circuits by hand that
read clearly afterwards. Every design choice favors that goal:

- **Readability** Circuits are plain code with named parts, and the
  simulator is simple enough to read in one sitting. Performance is "good
  enough to explore", not optimized.
- **Strict typing** Signals start as unknown (`X`), gates take time,
  glitches and races show up, and nothing is quietly rounded to 0 or 1.
- **Observability** Every wire's value, every transition, and the whole
  hierarchy can be inspected, so you can see why a circuit does what it does.

It is **not**:

- a production hardware description language, or a replacement for Verilog
  or VHDL
- a high-performance simulator for large designs, or a component to embed in
  a larger system
- an electrical, analog or transistor-level simulator

### Using it with AI agents

Agents are welcome as tutors and pair-builders. Typed port names, descriptive
errors and serializable introspection make the library easy for them to work
with. The person learning is still the point, though. When an agent helps, it
should prefer small, well-named circuits a human can follow, explain what each
part does, and leave the learner room to build things themselves. It shouldn't
produce large generated or optimized netlists.

## Features

- One interface for everything: a primitive gate and a 60-gate adder are both
  `ComponentDefinition`s, and either can be added to another circuit.
- Deterministic discrete-time simulation with unit gate delays, `X`
  propagation, feedback loops and a hard tick limit.
- Built for introspection: serializable topology, a flattened netlist, live
  signal snapshots and transition traces.
- Strict TypeScript, ESM only, zero runtime dependencies. Runs on Node.js, Bun
  and modern browsers.

## Install

```sh
pnpm add @pbzona/wires   # or npm install @pbzona/wires / bun add @pbzona/wires
```

There are two entry points:

| Import                     | Contents                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@pbzona/wires`            | the engine: `gate`, `circuit`, `bits`, `simulate`, `elaborate`, errors, types |
| `@pbzona/wires/components` | the standard library: `NAND`, `NOT`, `AND`, `OR`, `NOR`, `XOR`, `XNOR`, `HalfAdder`, `FullAdder`, `Mux`, `Demux`, `SRLatch`, `RegisterBit` |

Requires Node.js 24, or 26 and later (no end-of-life releases), Bun, or any
modern browser or bundler. The package is ESM only and has no runtime
dependencies.

## Signals

```ts
type Signal = 0 | 1 | "X"; // "X" means unknown or uninitialized
```

Every signal starts as `"X"`. You can write `"X"` directly or use
`import { X } from "@pbzona/wires"` if you prefer a named constant.
They are the same value, so `X === "X"`.

## Defining a primitive gate

```ts
import { gate, simulate } from "@pbzona/wires";

const NAND = gate({
  name: "NAND",
  inputs: ["a", "b"],
  outputs: ["out"],
  evaluate: ({ a, b }) => ({
    out: a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : "X",
  }),
});

const settled = simulate(NAND).set({ a: 1, b: 1 }).run();
settled.read("out"); // 0
```

`evaluate` must be pure and synchronous, and must return exactly the declared
outputs. Port names are inferred, so `settled.read("nope")` and
`settled.set({ c: 1 })` fail to compile. Gates may have any number of inputs and outputs, including
zero inputs (a constant source).

## Composing circuits

```ts
import { circuit, simulate } from "@pbzona/wires";
import { NAND } from "@pbzona/wires/components";

const ReadyLight = circuit(
  { name: "ReadyLight", inputs: ["busy"], outputs: ["lit"] },
  (chip) => {
    const busy = chip.inputs.busy;
    const inverter = chip.add(NAND, { a: busy, b: busy });
    chip.output("lit", inverter.outputs.out);
  },
);

const idle = simulate(ReadyLight).set({ busy: 0 }).run();
idle.read("lit"); // 1: the ready light is on
```

A primitive computes signal values; a circuit connects wires. Here `chip` is
our builder for `ReadyLight`. Both NAND inputs get the `busy` wire, so the
gate inverts it. Its `out` pin drives the light's `lit` pin. Every wiring
call reads **destination ← source**, like an assignment.

| Member                                           | Purpose                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `chip.inputs`                                    | the circuit's own inputs, used as sources for the parts you add        |
| `chip.add(definition, name?, { input: source })` | add a part and wire its inputs; unnamed parts get `"<Definition>#<n>"` |
| `chip.feed(part.inputs.x, source)`               | wire an input later, which is how feedback loops are made              |
| `chip.output(name, source)`                      | drive one of the circuit's own outputs                                 |

Sources are the circuit's inputs and the outputs of parts it added. One source
can feed any number of inputs, but each input has exactly one source. Using a
part's input as a source, or misspelling a declared name, is a compile-time
error. The builder also checks connections at runtime, including the bounds
of numbered pins.

Feedback needs `chip.feed`, because a part's input can't be wired to something that
hasn't been added yet:

```ts
import { circuit } from "@pbzona/wires";
import { NAND } from "@pbzona/wires/components";

const SRLatch = circuit(
  { name: "SRLatch", inputs: ["setN", "resetN"], outputs: ["q", "qBar"] },
  (chip) => {
    const top = chip.add(NAND, "top", { a: chip.inputs.setN }); // b is fed back below
    const bottom = chip.add(NAND, "bottom", {
      a: chip.inputs.resetN,
      b: top.outputs.out,
    });
    chip.feed(top.inputs.b, bottom.outputs.out); // the feedback wire
    chip.output("q", top.outputs.out);
    chip.output("qBar", bottom.outputs.out);
  },
);
```

The builder runs immediately, inside `circuit()`, and the result is validated
before `circuit()` returns, so mistakes are reported where you made them. A
circuit can only contain components defined before it, so it can never
contain itself.

### Wiring a group of bits

In `circuit()` (not `gate()`), `bits("d", 8)` declares individual pins `d0`
through `d7`. Mix groups with named scalars: `[bits("d", 8), "clock", "load"]`.
In the builder, `chip.inputs.d[3]` and `chip.inputs.d3` refer to the same source. A parent
can connect one register to another with `{ d: first.outputs.q, clock, load }`;
`chip.output("q", sources)` publishes a whole group in index order. Both operations
require one source per bit. Group names and expanded pin names cannot collide.

The group is not an integer-valued signal. Simulation and inspection still use
`set({ d3: 1 })`, `read("q3")` and `inspect().signals["root.outputs.q3"]`.
Each bit has its own signal and gate delays. See the
[eight-bit register example](https://github.com/pbzona/wires/blob/main/packages/wires/examples/Register8.ts).

## A four-bit adder

```ts
import { circuit, simulate, type SourcePort } from "@pbzona/wires";
import { FullAdder } from "@pbzona/wires/components";

const Adder4 = circuit(
  {
    name: "Adder4",
    inputs: ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3", "carryIn"],
    outputs: ["s0", "s1", "s2", "s3", "carryOut"],
  },
  (chip) => {
    let carry: SourcePort = chip.inputs.carryIn;
    for (const i of [0, 1, 2, 3] as const) {
      const fa = chip.add(FullAdder, `fa${i}`, {
        a: chip.inputs[`a${i}`],
        b: chip.inputs[`b${i}`],
        carryIn: carry,
      });
      chip.output(`s${i}`, fa.outputs.sum);
      carry = fa.outputs.carryOut;
    }
    chip.output("carryOut", carry);
  },
);

const sim = simulate(Adder4)
  .set({ a0: 1, a1: 1, a2: 0, a3: 0, b0: 0, b1: 0, b2: 1, b3: 0, carryIn: 0 }) // 3 + 4
  .run();
sim.readAll(); // { s0: 1, s1: 1, s2: 1, s3: 0, carryOut: 0 } = 7
```

## Sequential logic

```ts
import { simulate, StabilizationError } from "@pbzona/wires";
import { SRLatch } from "@pbzona/wires/components";

let latch = simulate(SRLatch);

latch = latch.set({ setN: 1, resetN: 1 }).run();
latch.readAll(); // { q: "X", qBar: "X" }, never initialized, so it stays unknown

latch = latch.set({ setN: 0 }).run(); // set (active low)
latch = latch.set({ setN: 1 }).run(); // release
latch.readAll(); // { q: 1, qBar: 0 }, still remembers the 1

latch = latch.set({ setN: 0, resetN: 0 }).run(); // forbidden
latch.readAll(); // { q: 1, qBar: 1 }, not a valid stored state

try {
  latch.set({ setN: 1, resetN: 1 }).run(); // release both at once: a race
} catch (error) {
  error instanceof StabilizationError; // true: q and qBar oscillate forever
}
```

## Simulation

A simulation is a sequence of **states**. `simulate()` returns the first one,
and every method that moves the simulation forward returns a _new_ state. The
state you called it on never changes:

```ts
const start = simulate(ReadyLight, { maxTicks: 10_000, trace: false }); // defaults shown
const assigned = start.set({ busy: 0 }); // a new state; start is untouched
const settled = assigned.run(); // another new state
settled.read("lit"); // 1
start.read("lit"); // still "X"
```

Write it step by step with `let sim = ...; sim = sim.set(...).run();`, or keep
the states you care about and branch from them. Forgetting to reassign is the
one mistake to watch for: a bare `sim.set({ busy: 1 })` returns a new state and
leaves `sim` as it was.

| Member                     | Behavior                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `set(inputs)`              | new state with some or all external inputs assigned; they take effect on the next step          |
| `step()`                   | new state, one tick later                                                                       |
| `run()`                    | new state, stepped until stable; throws `StabilizationError` after `maxTicks` steps in one call |
| `read(name)` / `readAll()` | current output values; never advance time                                                       |
| `tick`                     | simulation time: the next tick to be processed                                                  |
| `stable`                   | true when nothing is pending and every gate has had its first evaluation                        |
| `changes`                  | the wire changes applied by the step that produced this state                                   |
| `inspect()`                | `{ tick, stable, pendingEvents, signals, wires }` as plain data                                 |
| `trace()`                  | every wire change up to this state, oldest first (empty unless `trace: true`)                   |

Because states never change:

- **Starting over** means going back to the first state. There's no `reset()`.
- **History** is just the states you keep:
  `while (!s.stable) states.push((s = s.step()))`.
- **Branching** is free. Settle a latch once, then try setting it and
  resetting it, both starting from that same state.
- **Errors don't corrupt anything.** If a run throws, the state you called it
  on is still valid.

### Timing model

- Every primitive has a delay of one tick. Wires, including a direct
  input → output connection, have no delay.
- Each step:
  1. Apply the pending changes.
  2. Find the gates reading a changed wire. The first step evaluates every
     gate once.
  3. Evaluate those gates against one consistent set of values.
  4. Outputs that actually changed become pending for the next step.
  5. Advance time.
- Only changed values create events, and only affected gates are evaluated.
- Wires and gates are processed in sorted id order, so results never depend on
  the order components were declared in.
- `X` is never resolved to 0 or 1. Feedback loops end up in one of three
  states: stable (latch holds), stable but unknown (uninitialized latch), or
  non-converging (`StabilizationError`).

## Introspection

**Topology.** `definition.describe()` returns a serializable tree. Each
component has a stable hierarchical id (`root`, `root.not`, `root.not.g`), its
`parent`, `definition` name, `kind` (`"primitive"` or `"composite"`), ports,
children and connections.

```ts
import { AND } from "@pbzona/wires/components";

AND.describe().connections;
// [{ source: "root.inputs.a", destination: "root.nand.inputs.a" }, ...]
```

**Wires.** A _wire_ is one driver (a circuit input or a gate output) plus
every port connected to it. All of them always carry the same value. A wire is
named after its driver, so the wire that leaves `AND`'s inner NAND is
`root.nand.outputs.out`, even though it also reaches `root.not.inputs.a` and
both inputs of `root.not.g`.

**Netlist.** `elaborate(definition)` returns the flattened graph that the
simulator executes: primitive `gates` (each with `path` and `ancestors`),
`wires` (each with its driver, every port on it, and the gates that read it),
and `portWires`, which maps every port to its wire.

**State.** `state.inspect()` returns plain data. `signals` gives every port's
value, and `wires` groups ports by wire:

```ts
{
  tick: 3,
  stable: true,
  pendingEvents: 0,
  signals: {
    "root.inputs.a": 1,
    "root.inputs.b": 1,
    "root.outputs.out": 1,
    "root.nand.inputs.a": 1,
    // ...every port in the hierarchy
    "root.not.g.outputs.out": 1,
  },
  wires: {
    "root.nand.outputs.out": {
      value: 0,
      ports: ["root.nand.outputs.out", "root.not.inputs.a", "root.not.g.inputs.a", "root.not.g.inputs.b"],
    },
    // ...one entry per wire
  },
}
```

**Trace.** With `trace: true`, every wire change is recorded in order. Within a
tick, entries are sorted by wire id.

```ts
simulate(AND, { trace: true }).set({ a: 1, b: 1 }).run().trace();
// [
//   { tick: 0, wire: "root.inputs.a", previous: "X", value: 1 },
//   { tick: 0, wire: "root.inputs.b", previous: "X", value: 1 },
//   { tick: 1, wire: "root.nand.outputs.out", previous: "X", value: 0 },
//   { tick: 2, wire: "root.not.g.outputs.out", previous: "X", value: 1 },
// ]
```

## Errors

All errors extend `WiresError`.

| Error                | When                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CircuitError`       | Invalid names; duplicate ports or instance names; inputs or outputs that don't exist; a part's input used as a source; ports from another circuit; multiple drivers; unconnected child inputs; undriven outputs; components that aren't defined yet; wire loops with no gate. Messages are prefixed with the circuit name and use component paths. |
| `SimulationError`    | Unknown inputs or outputs, invalid signal values, or an evaluator that throws or returns missing, unexpected or invalid outputs. The message names the primitive and its path.                                                                                                                                                                     |
| `StabilizationError` | `run()` exceeded `maxTicks`. Exposes `tick`, `ticksExecuted`, `maxTicks`, `recentChanges` and `components` (paths of the gates involved).                                                                                                                                                                                                          |

States are never modified, so after any error the state you called the method
on is still valid.

## Standard library

Everything except `NAND` is built from NAND gates through the public
`circuit()` API.

| Component                         | Inputs        | Outputs       | Notes                          |
| --------------------------------- | ------------- | ------------- | ------------------------------ |
| `NAND`                            | a, b          | out           | the only primitive             |
| `NOT`                             | a             | out           |                                |
| `AND`, `OR`, `NOR`, `XOR`, `XNOR` | a, b          | out           |                                |
| `HalfAdder`                       | a, b          | sum, carry    |                                |
| `FullAdder`                       | a, b, carryIn | sum, carryOut |                                |
| `Mux`                             | a, b, select  | out           | `select = 0` → a, `1` → b      |
| `Demux`                           | in, select    | a, b          | the unselected output is 0     |
| `SRLatch`                         | setN, resetN  | q, qBar       | active-low cross-coupled NANDs |
| `RegisterBit`                     | d, clock, load | q            | rising edge, active-high load  |

Because these are NAND networks, they inherit NAND's pessimistic handling of
`X`. For example, `Mux` gives `X` when `select` is `X`, even if `a === b`.

## Examples

From `packages/wires` in a [source checkout](https://github.com/pbzona/wires#readme) (the npm package does not include the demo scripts):

```sh
pnpm build
node examples/01-gates.ts          # NAND truth table, including X
node examples/02-composition.ts    # NOT/AND from NAND, inspect and trace
node examples/03-four-bit-adder.ts # ripple-carry adder
node examples/04-sr-latch.ts       # one bit of memory
node examples/05-register.ts       # two eight-bit registers on one clock
# or all at once:
pnpm examples
```

The examples import `@pbzona/wires` by name, which resolves to the built `dist/`. They
run directly on Node 24+ (native type stripping) or Bun.

## Development

This package lives in the `packages/wires` folder of a Turborepo monorepo,
next to the documentation site in `apps/docs`. Run `pnpm install` once at the
repository root. Then, inside `packages/wires`:

```sh
pnpm typecheck   # tsc: src, tests (including @ts-expect-error API checks) and examples
pnpm test        # vitest
pnpm build       # emits dist/ with .d.ts files
```

Or run everything for every package from the root with `pnpm check`.

[DESIGN.md](https://github.com/pbzona/wires/blob/main/packages/wires/DESIGN.md) covers the internal representation and where the
implementation deviates from the original specification.
