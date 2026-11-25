# A circuit workbench for wires

`npm create @pbzona/wires my-lab` should scaffold a vanilla TypeScript Vite app with a working circuit on the canvas and a custom NAND-gate favicon. Start with a half adder: toggle its inputs, step the simulation, and watch `sum` and `carry` change. The same canvas should let the learner wire a new chip and use it in a larger one.

## One chip format, one palette

These directories belong to the **generated project**, not the `wires` package:

| Directory | Purpose | Can the editor write here? |
| --- | --- | --- |
| `chips/` | The learner's library. Hand-written and canvas-saved chips are ordinary TypeScript modules with named `gate()` or `circuit()` exports. | Only to create a new chip file. |
| `examples/` | Importable starter examples, such as a four-bit adder. | No. |
| `src/` | App entry point, styles, and editor setup. | No. |

The starter discovers chip exports with Vite; the editor itself accepts definitions and their import locations and doesn't require Vite or React. One searchable palette labels entries **Mine**, **Examples**, or **Standard**. The standard entries come from `@pbzona/wires/components`. No manual registry or editor-specific chip format is needed. If two groups contain `HalfAdder`, both remain selectable; generated imports identify the one the learner actually placed.

Keep example definitions separate from scripts that run them. Today `packages/wires/examples/03-four-bit-adder.ts` defines `Adder4` and runs sample additions at module load. Share the definition, not the script: importing the example in the editor must not run a simulation or print to the console. Using an example does not copy it into `chips/`.

## From canvas to source

Keep a draft while the learner adds parts, names ports, and connects them. A disconnected pin is fine in a draft: point to it on the canvas and explain what must be connected before simulating or saving. Do not drive it with a made-up signal. Compile complete drafts with the public `circuit()` builder, including `feed()` for feedback.

The Source drawer shows the readable TypeScript that **Copy TypeScript** copies and **Save as chip** writes. A saved chip imports the definitions it uses rather than inlining their internals. Saving `MyAdder` creates `chips/MyAdder.ts`; it then appears in the palette. Opening an existing chip is for inspection, not a promise to reconstruct the author's loops, comments, or layout. A learner can copy its source or create a new chip without modifying the original.

File creation belongs to the scaffold's local Vite dev server. Accept a chip identifier, not a filesystem path; create the new `.ts` file exclusively and report a name conflict without touching existing contents. When served as a static site, retain Copy without claiming to save to disk.

## Drawing and simulation

Publish a framework-neutral `@pbzona/wires-editor` that mounts into a host element. Use a canvas for nodes and wires, with ordinary HTML controls for the palette, selected part, inputs, Step, and Run. A React app can mount the same editor; don't require a React-specific implementation without a demonstrated need.

Draw one circuit level at a time. For example, `Adder4` starts as four full adders, not a sheet of NAND gates. Opening a child shows its wiring and a breadcrumb back to the parent. Show `0`, `1`, and `X` with labels as well as color. Keep simulation separate from drawing: moving a node or panning must not elaborate the circuit or advance a tick. Use the existing simulator for propagation, delays, and stabilization errors.

## Acceptance checks

- Scaffold into an empty directory, install and build it, then open the example in a browser.
- Add a hand-written chip to `chips/`. Place it alongside an example, connect ports, and save the result. Import the saved module in plain TypeScript without the editor and compare its simulation to the draft's, including `X` and tick timing.
- Try to save under an existing name: verify the original file is unchanged. Verify example imports have no demo side effects.
- Open a four-bit adder and a larger repeated hierarchy. Verify that visible node count follows the open level and that panning does not trigger simulation. Measure rendering and simulation separately before adding a worker or changing renderers.
