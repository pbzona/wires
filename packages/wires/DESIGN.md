# Design notes

Short record of the internal representation chosen for `wires` and where it
deliberately deviates from the original specification.

## Internal representation

**Definitions.** `gate()` and `circuit()` both return a frozen
`ComponentDefinition` (`kind`, `name`, `inputs`, `outputs`, `describe()`).
Internal data (the evaluator, or the built instance/connection lists) lives in a
module-private `WeakMap`, so the public objects stay small and immutable.

**Lazy, memoized circuit construction.** A composite's builder callback runs
once, on first use: when the circuit is added to another circuit, described,
elaborated or simulated. Running it lazily is what makes recursion detectable
(`const X = circuit(..., ({ add }) => add(X))` would otherwise be a TDZ
`ReferenceError`). Adding a composite forces it to build, so a definition that
is still building when it is added again (X → Y → X) is reported as a recursive
definition with the full chain.

**Ports.** Port handles are plain frozen objects:
`{ kind: "port", id: "inputs.a", name, direction, role, owner }`.
`role` is the port's role *inside the current circuit scope*:

| Port | direction | role |
|---|---|---|
| circuit's own input (`inputs.a`) | input | source |
| circuit's own output (`outputs.out`) | output | sink |
| child input (`g.inputs.a`) | input | sink |
| child output (`g.outputs.out`) | output | source |

`connect(source, destination)` is typed as `(SourcePort, SinkPort)`, so wiring
in the wrong direction or naming a port that doesn't exist fails at compile
time. The same checks run again at runtime for untyped callers.

**Elaboration.** The hierarchy is flattened into a netlist. Each connection
makes its destination an alias of its source, with no delay. Every port path
(`root.not.g.inputs.a`) resolves to a **net**, named after its single driver:
either a root input (`root.inputs.a`) or a primitive output
(`root.nand.outputs.out`). Nets and gates are sorted by id, so simulation
order never depends on declaration order. Each gate keeps its chain of
composite ancestors.

**Simulation.** Net values live in a flat `Signal[]`. A tick-keyed event queue
(`Map<tick, Map<net, Signal>>`) holds pending changes. One tick applies that
tick's changes (in net order), evaluates only the gates reading changed nets
(every gate is evaluated on the first tick), and schedules any changed outputs
for `tick + 1`. All gates in a tick read the same snapshot because writes only
go to the queue.

## Deviations and clarifications

- **Package name** is `wires`. The component library ships as the separate
  subpath export `wires/components`, keeping it apart from the engine.
- **Auto-generated instance names** take the form `<Definition>#<n>` (for
  example `XOR#0`). Explicit names must be identifiers, so they can never
  collide with generated ones. `inputs` and `outputs` are reserved instance
  names.
- **Port names must be unique across inputs and outputs** of a component.
- **Signals are nets.** `inspect().signals` reports every port path in the
  hierarchy (a superset of the spec's example). Trace entries use the net id,
  meaning the driver's path, which matches the trace example in the spec.
- **Zero-delay wires, unit-delay gates.** Connections, including direct
  input → output wires, add no delay. Each primitive adds one tick.
- **Wire loops with no gate** (possible through pass-through composites) are
  rejected during elaboration, because such a net has no driver.
- **`run()` returns `{ ticks, tick }`**: how many ticks this call executed and
  the simulation time after it.
- **Non-converging runs** throw `StabilizationError`, which carries the current
  tick, the ticks executed, recent transitions, and the gate paths involved. A
  bounded buffer of recent transitions is kept even when tracing is off.
- **X pessimism.** Standard components are pure NAND networks, so they inherit
  NAND's X propagation. For example, the multiplexer gives `X` when `select` is
  `X`, even if `a === b`.
