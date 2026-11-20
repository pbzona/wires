# wires

A TypeScript toolkit for **learning** how digital logic works, by building it
yourself from a single NAND gate up to adders and memory, then simulating it
and looking inside.

## Who this is for

`wires` is a learning tool for people. It exists so you can understand how
computation is built from very simple parts, writing circuits by hand that
read clearly afterwards. Every design choice favors that goal:

- **Readable over fast.** Circuits are plain code with named parts, and the
  simulator is simple enough to read in one sitting. Performance is "good
  enough to explore", not optimized.
- **Honest over convenient.** Signals start as unknown (`X`), gates take time,
  glitches and races show up, and nothing is quietly rounded to 0 or 1.
- **Visible over hidden.** Every wire's value, every transition, and the whole
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
pnpm add wires   # or npm install wires / bun add wires
```

There are two entry points:

| Import | Contents |
|---|---|
| `wires` | the engine: `gate`, `circuit`, `simulate`, `elaborate`, errors, types |
| `wires/components` | the standard library: `NAND`, `NOT`, `AND`, `OR`, `NOR`, `XOR`, `XNOR`, `HalfAdder`, `FullAdder`, `Mux`, `Demux`, `SRLatch` |

## Signals

```ts
type Signal = 0 | 1 | "X"; // "X" means unknown or uninitialized
```

Every signal starts as `X`. Logic compares values with `===` and never relies on
truthiness. `true` is not a signal.

## Defining a primitive gate

```ts
import { gate, simulate } from "wires";

const NAND = gate({
  name: "NAND",
  inputs: ["a", "b"],
  outputs: ["out"],
  evaluate: ({ a, b }) => ({
    out: a === 0 || b === 0 ? 1 : a === 1 && b === 1 ? 0 : "X",
  }),
});

const sim = simulate(NAND);
sim.set({ a: 1, b: 1 });
sim.run();
sim.read("out"); // 0
```

`evaluate` must be pure and synchronous, and must return exactly the declared
outputs. Port names are inferred, so `sim.read("nope")` and `sim.set({ c: 1 })`
fail to compile. Gates may have any number of inputs and outputs, including
zero inputs (a constant source).

## Composing circuits

```ts
import { circuit, simulate } from "wires";
import { NAND } from "wires/components";

const NOT = circuit({ name: "NOT", inputs: ["a"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const g = add(NAND, "g", { a: inputs.a, b: inputs.a });
  output("out", g.outputs.out);
});

const AND = circuit({ name: "AND", inputs: ["a", "b"], outputs: ["out"] }, ({ inputs, add, output }) => {
  const nand = add(NAND, "nand", { a: inputs.a, b: inputs.b });
  const not = add(NOT, "not", { a: nand.outputs.out }); // composites are added exactly like primitives
  output("out", not.outputs.out);
});

const sim = simulate(AND);
sim.set({ a: 1, b: 1 });
sim.run();
sim.read("out"); // 1
sim.set({ a: 0 });
sim.run();
sim.read("out"); // 0
```

Each line adds one part and says what feeds it, so signals flow from top to
bottom. Every wiring call reads **destination ← source**, like an assignment.

| Member | Purpose |
|---|---|
| `inputs` | the circuit's own inputs, used as sources for the parts you add |
| `add(definition, name?, { input: source })` | add a part and wire its inputs; unnamed parts get `"<Definition>#<n>"` |
| `feed(part.inputs.x, source)` | wire an input later, which is how feedback loops are made |
| `output(name, source)` | drive one of the circuit's own outputs |

Sources are the circuit's inputs and the outputs of parts it added. One source
can feed any number of inputs, but each input has exactly one source. Using a
part's input as a source, or naming a port that doesn't exist, is a
compile-time error, and is rejected again at runtime.

Feedback needs `feed`, because a part's input can't be wired to something that
hasn't been added yet:

```ts
import { circuit } from "wires";
import { NAND } from "wires/components";

const SRLatch = circuit(
  { name: "SRLatch", inputs: ["setN", "resetN"], outputs: ["q", "qBar"] },
  ({ inputs, add, feed, output }) => {
    const top = add(NAND, "top", { a: inputs.setN }); // b is fed back below
    const bottom = add(NAND, "bottom", { a: inputs.resetN, b: top.outputs.out });
    feed(top.inputs.b, bottom.outputs.out); // the feedback wire
    output("q", top.outputs.out);
    output("qBar", bottom.outputs.out);
  },
);
```

The builder runs immediately, inside `circuit()`, and the result is validated
before `circuit()` returns, so mistakes are reported where you made them. A
circuit can only contain components defined before it, so it can never
contain itself.

## A four-bit adder

```ts
import { circuit, simulate, type SourcePort } from "wires";
import { FullAdder } from "wires/components";

const Adder4 = circuit(
  {
    name: "Adder4",
    inputs: ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "b3", "carryIn"],
    outputs: ["s0", "s1", "s2", "s3", "carryOut"],
  },
  ({ inputs, add, output }) => {
    let carry: SourcePort = inputs.carryIn;
    for (const i of [0, 1, 2, 3] as const) {
      const fa = add(FullAdder, `fa${i}`, { a: inputs[`a${i}`], b: inputs[`b${i}`], carryIn: carry });
      output(`s${i}`, fa.outputs.sum);
      carry = fa.outputs.carryOut;
    }
    output("carryOut", carry);
  },
);

const sim = simulate(Adder4);
sim.set({ a0: 1, a1: 1, a2: 0, a3: 0, b0: 0, b1: 0, b2: 1, b3: 0, carryIn: 0 }); // 3 + 4
sim.run();
sim.readAll(); // { s0: 1, s1: 1, s2: 1, s3: 0, carryOut: 0 } = 7
```

## Sequential logic

```ts
import { simulate, StabilizationError } from "wires";
import { SRLatch } from "wires/components";

const latch = simulate(SRLatch);

latch.set({ setN: 1, resetN: 1 });
latch.run();
latch.readAll(); // { q: "X", qBar: "X" }, never initialized, so it stays unknown

latch.set({ setN: 0 }); // set (active low)
latch.run();
latch.set({ setN: 1 }); // release
latch.run();
latch.readAll(); // { q: 1, qBar: 0 }, still remembers the 1

latch.set({ setN: 0, resetN: 0 }); // forbidden
latch.run();
latch.readAll(); // { q: 1, qBar: 1 }, not a valid stored state

latch.set({ setN: 1, resetN: 1 }); // release both at once: a race
try {
  latch.run();
} catch (error) {
  error instanceof StabilizationError; // true: q and qBar oscillate forever
}
```

## Simulation

```ts
const sim = simulate(definition, { maxTicks: 10_000, trace: false }); // defaults shown
```

| Method | Behavior |
|---|---|
| `set(inputs)` | assign some or all external inputs; changes apply at the current tick |
| `read(name)` | current value of one output; never advances time |
| `readAll()` | current values of all outputs |
| `tick()` | process the current tick and advance time by one |
| `run()` | tick until nothing is scheduled; returns `{ ticks, tick }`; throws `StabilizationError` after `maxTicks` ticks in one call |
| `reset()` | back to time 0 with every signal `X`, inputs included; clears the queue and the trace |
| `inspect()` | `{ tick, signals, pendingEvents, stable }`, where `signals` has the value of every port in the hierarchy |
| `trace()` | frozen copy of recorded transitions (empty unless `trace: true`) |

Simulators are independent: any number can run on one definition without
sharing state. Reading never evaluates anything. Time moves only when you call
`tick()` or `run()`.

### Timing model

- Every primitive has a delay of one tick. Wires, including a direct
  input → output connection, have no delay.
- Each tick:
  1. Apply the changes scheduled for this tick.
  2. Find the gates reading a changed signal. The first tick evaluates every
     gate once.
  3. Evaluate those gates against one consistent snapshot.
  4. Schedule outputs that actually changed for the next tick.
  5. Advance time.
- Only changed values create events, and only affected gates are evaluated.
- Nets and gates are processed in sorted id order, so results never depend on
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
AND.describe().connections;
// [{ source: "root.inputs.a", destination: "root.nand.inputs.a" }, ...]
```

**Netlist.** `elaborate(definition)` returns the flattened graph that the
simulator executes: primitive `gates` (each with `path` and `ancestors`), `nets`
(each with its driver, every port aliased to it, and its readers), and
`portNets`, which maps every port to its net.

**State.** `sim.inspect()`:

```ts
{
  tick: 3,
  signals: {
    "root.inputs.a": 1,
    "root.inputs.b": 1,
    "root.outputs.out": 1,
    "root.nand.inputs.a": 1,
    // ...every port in the hierarchy
    "root.not.g.outputs.out": 1,
  },
  pendingEvents: 0,
  stable: true,
}
```

**Trace.** With `trace: true`, every transition is recorded in order. Within a
tick, entries are sorted by signal id. A signal id is the net's driver path.

```ts
const sim = simulate(AND, { trace: true });
sim.set({ a: 1, b: 1 });
sim.run();
sim.trace();
// [
//   { tick: 0, signalId: "root.inputs.a", previous: "X", value: 1 },
//   { tick: 0, signalId: "root.inputs.b", previous: "X", value: 1 },
//   { tick: 1, signalId: "root.nand.outputs.out", previous: "X", value: 0 },
//   { tick: 2, signalId: "root.not.g.outputs.out", previous: "X", value: 1 },
// ]
```

## Errors

All errors extend `WiresError`.

| Error | When |
|---|---|
| `CircuitError` | Invalid names; duplicate ports or instance names; inputs or outputs that don't exist; a part's input used as a source; ports from another circuit; multiple drivers; unconnected child inputs; undriven outputs; components that aren't defined yet; wire loops with no gate. Messages are prefixed with the circuit name and use component paths. |
| `SimulationError` | Unknown inputs or outputs, invalid signal values, or an evaluator that throws or returns missing, unexpected or invalid outputs. The message names the primitive and its path. |
| `StabilizationError` | `run()` exceeded `maxTicks`. Exposes `tick`, `ticksExecuted`, `maxTicks`, `recentChanges` and `components` (paths of the gates involved). |

After a `SimulationError` thrown in the middle of a tick, call `reset()`.

## Standard library

Everything except `NAND` is built from NAND gates through the public
`circuit()` API.

| Component | Inputs | Outputs | Notes |
|---|---|---|---|
| `NAND` | a, b | out | the only primitive |
| `NOT` | a | out | |
| `AND`, `OR`, `NOR`, `XOR`, `XNOR` | a, b | out | |
| `HalfAdder` | a, b | sum, carry | |
| `FullAdder` | a, b, carryIn | sum, carryOut | |
| `Mux` | a, b, select | out | `select = 0` → a, `1` → b |
| `Demux` | in, select | a, b | the unselected output is 0 |
| `SRLatch` | setN, resetN | q, qBar | active-low cross-coupled NANDs |

Because these are NAND networks, they inherit NAND's pessimistic handling of
`X`. For example, `Mux` gives `X` when `select` is `X`, even if `a === b`.

## Examples

From `packages/wires`:

```sh
pnpm build
node examples/01-gates.ts          # NAND truth table, including X
node examples/02-composition.ts    # NOT/AND from NAND, inspect and trace
node examples/03-four-bit-adder.ts # ripple-carry adder
node examples/04-sr-latch.ts       # one bit of memory
# or all at once:
pnpm examples
```

The examples import `wires` by name, which resolves to the built `dist/`. They
run directly on Node ≥ 22.18 (native type stripping) or Bun.

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

[DESIGN.md](./DESIGN.md) covers the internal representation and where the
implementation deviates from the original specification.
