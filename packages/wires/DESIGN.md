# Design notes

Short record of the internal representation chosen for `wires` and where it
deliberately deviates from the original specification.

## Internal representation

**Definitions.** `gate()` and `circuit()` both return a frozen
`ComponentDefinition` (`kind`, `name`, `inputs`, `outputs`, `describe()`).
Internal data (the evaluator, or the built instance/connection lists) lives in a
module-private `WeakMap`, so the public objects stay small and immutable.

**Eager circuit construction.** A composite's builder callback runs inside
`circuit()`, and its result is validated before `circuit()` returns, so errors
point at the circuit being defined. Because a circuit can only `add` definitions
that already exist, recursive definitions can't be expressed at all. That
covers the spec's "recursive definitions" requirement structurally rather than
with a runtime check. Passing a not-yet-defined (`undefined`) component to
`add` gets a dedicated error message.

**Ports.** Port handles are plain frozen objects:
`{ kind: "port", id: "inputs.a", name, direction, role, owner }`.
`role` is the port's role *inside the current circuit scope*:

| Port | direction | role |
|---|---|---|
| circuit's own input (`inputs.a`) | input | source |
| circuit's own output (driven by `output("out", …)`) | output | sink |
| child input (`g.inputs.a`) | input | sink |
| child output (`g.outputs.out`) | output | source |

**Bit groups.** A circuit declaration such as `bits("d", 8)` expands to `d0` through
`d7` before the builder runs. The definition lists those scalar pins in order
and records their group in `inputGroups` or `outputGroups`. In a builder,
`inputs.d` is a frozen array of the same handles as `inputs.d0` through
`inputs.d7`. Assigning a group checks its width and each connection before
recording any of them. There is no group-valued signal in the netlist or
simulator, and `gate()` declarations still name individual pins.

**Wiring API.** The builder exposes `inputs`, `add`, `feed` and `output`. Every
call reads *destination ← source*, like an assignment:

- `add(def, name?, { a: source })` adds a part and wires the inputs it lists.
  Signal flow reads top to bottom, and you never name a child input as a
  destination.
- `feed(part.inputs.b, source)` wires an input later. It exists for feedback,
  where the source is added after the part it feeds.
- `output("out", source)` drives the circuit's own output, so the circuit's
  outputs never appear as handles you could mistake for sources.

This replaces an earlier `connect(source, destination)` design. There, the
word "inputs" meant a source for the circuit's own ports but a destination for
a child's ports, and the signal direction was carried only by argument order.
Sources are typed as `SourcePort`, so passing a child input as a source, using
an unknown input name in the `add` record, or naming an unknown output fails at
compile time. The same checks run again at runtime for untyped callers.

**Elaboration and wires.** The hierarchy is flattened into a netlist. Each
connection makes its destination an alias of its source, with no delay. Every
port path (`root.not.g.inputs.a`) resolves to a **wire**, named after its single
driver: either a root input (`root.inputs.a`) or a primitive output
(`root.nand.outputs.out`). "Wire" is used instead of the usual hardware term
"net" because it's the word learners already have. Wires and gates are sorted by
id, so simulation order never depends on declaration order. Each gate keeps its
chain of composite ancestors.

**Simulation as immutable states.** `simulate()` returns the initial
`SimulationState`. `set()`, `step()` and `run()` return new states and never
modify the receiver, so callers can keep, compare and branch from any state.
Each state holds:

- `values`: a frozen `Signal[]` with one entry per wire.
- `pending`: a map of wire changes to apply on the next step. With unit gate
  delays, every pending change belongs to the next step, so no tick-keyed queue
  is needed. Variable delays would bring one back.
- `firstStep`: true when the gates still need their initial evaluation. A circuit with no gates starts stable.
- `changes`: the transitions applied by the step that produced the state.
- `trace`: when tracing, a linked list of per-step transition batches shared
  between states, so branches share their common history without copying it.

A step copies `values`, applies the pending changes in wire order, evaluates
only the gates that read a changed wire, and collects their changed outputs as
the next state's `pending`. Gates never write to `values`, so all of them see
the same inputs. Copying one array per step is negligible at learning scale.

## Deviations and clarifications

- **Supported runtimes are a policy, not a technical floor.** The library only
  uses ES2022 features, but it supports only maintained Node.js releases:
  24, or 26 and later. `engines` declares this for consumers, and the root
  `devEngines` enforces it when working in the repo.
- **Package name** is `@pbzona/wires` on npm (the project is called `wires`).
  The component library ships as the separate subpath export
  `@pbzona/wires/components`, keeping it apart from the engine.
- **Auto-generated instance names** take the form `<Definition>#<n>` (for
  example `XOR#0`). Explicit names must be identifiers, so they can never
  collide with generated ones. `inputs` and `outputs` are reserved instance
  names.
- **Port names must be unique across inputs and outputs** of a component.
- **Signals are wires.** `inspect().signals` reports every port path in the
  hierarchy (a superset of the spec's example), and `inspect().wires` groups
  ports by wire. Trace entries name the wire by its driver's path, as in the
  spec's trace example, but the field is `wire` rather than `signalId`.
- **Zero-delay connections, unit-delay gates.** Connections, including direct
  input → output wires, add no delay. Each primitive adds one tick.
- **Wire loops with no gate** (possible through pass-through composites) are
  rejected during elaboration, because such a wire has no driver.
- **Immutable states instead of a mutable simulator.** The spec's `tick()` is
  `step()`, because `tick` is the state's time. There's no `reset()`; keep the
  initial state instead. `run()` returns the settled state, and the ticks it
  took are `after.tick - before.tick`.
- **Non-converging runs** throw `StabilizationError`, which carries the current
  tick, the ticks executed, recent transitions, and the gate paths involved.
  `run()` keeps a bounded buffer of recent transitions even when tracing is off.
- **X pessimism.** Standard components are pure NAND networks, so they inherit
  NAND's X propagation. For example, the multiplexer gives `X` when `select` is
  `X`, even if `a === b`.
