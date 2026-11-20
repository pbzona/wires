# wires

A TypeScript toolkit for learning how computers work by building digital logic
yourself, from a single NAND gate up, then simulating it and looking inside.

`wires` is a **learning tool for people**: circuits you can read and write by
hand, a simulator simple enough to understand, and honest behavior (unknown
states, gate delays, glitches) instead of shortcuts. It is _not_ a
production-grade HDL or a high-performance simulator to embed in a larger
system. AI agents are welcome as tutors and helpers, but the goal is human
understanding, not generating optimized circuits. See
[Who this is for](./packages/wires/README.md#who-this-is-for).

| Path                                 | Package                     | Description                                                                              |
| ------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------- |
| [`packages/wires`](./packages/wires) | `@pbzona/wires` (published) | The library: engine (`@pbzona/wires`) and standard components (`@pbzona/wires/components`) |
| [`apps/docs`](./apps/docs)           | `docs` (private)            | The [Mintlify](https://mintlify.com) documentation site                                  |

## Getting started

Requires Node.js ≥ 22.18.

```sh
pnpm install
pnpm check   # typecheck, test, build and lint every package
pnpm docs    # docs preview at http://localhost:3000
```

## Tasks

All root scripts run through `turbo`, which caches results and builds
`@pbzona/wires` before anything that depends on it.

| Command                  | What it runs                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `pnpm build`             | `@pbzona/wires`: compile to `dist/`                                                                          |
| `pnpm typecheck`         | `@pbzona/wires`: `tsc` over src, tests and examples                                                          |
| `pnpm test`              | `@pbzona/wires`: Vitest. `docs`: type-check and run every code example in the docs against the built library |
| `pnpm lint`              | `docs`: `mint validate` and `mint broken-links`                                                              |
| `pnpm check`             | All of the above                                                                                             |
| `pnpm dev` / `pnpm docs` | `mint dev` for the docs site                                                                                 |

To run one package's tasks, filter by name:
`pnpm turbo run test --filter=@pbzona/wires`.

## Publishing

`@pbzona/wires` is published to the public npm registry. Its `publishConfig`
pins `registry.npmjs.org` and public access, so a publish never goes to a
mirror or proxy configured as your default registry.

1. Bump `version` in `packages/wires/package.json`.
2. Run `pnpm check` from the root.
3. Log in to npm once: `npm login --registry https://registry.npmjs.org/`.
4. From `packages/wires`, preview the tarball with `pnpm publish --dry-run`,
   then publish with `pnpm publish`.

`prepublishOnly` runs the type check and tests, and `prepack` does a clean
build, so the tarball always contains a fresh `dist/`. The package ships
`dist/` (JavaScript, declarations and source maps), plus `src/` so
"go to definition" lands in readable TypeScript, `README.md` and `LICENSE`.
