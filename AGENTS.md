# Notes for agents working in this repository

`wires` is a learning tool for humans, not a production library. When you
change it, keep it something a person can read, write and understand by hand.

- **Readability beats performance.** Prefer a simple, obvious implementation
  over a faster or cleverer one. Don't add optimizations, caches or
  abstractions without a concrete, user-facing reason.
- **Keep the public API small and the behavior honest.** No hidden resolution
  of `X`, no skipping of gate delays, no shortcuts that make circuits behave
  better than the gate-level design would.
- **The standard library stays NAND-only** and is built with the public
  `circuit()` API, never with privileged access to the simulator.
- **Docs are part of the product.** Code examples in `apps/docs` are
  type-checked and executed by `pnpm test` (see
  `apps/docs/scripts/check-snippets.ts`). Keep them short, named, and
  explained.

Layout and commands are in [README.md](./README.md). Internal design notes are
in [packages/wires/DESIGN.md](./packages/wires/DESIGN.md). Run `pnpm check`
before finishing a change.
