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
| [`packages/wires`](./packages/wires) | `@pbzona/wires` | The library: engine (`@pbzona/wires`) and standard components (`@pbzona/wires/components`) |
| [`packages/wires-editor`](./packages/wires-editor) | `@pbzona/wires-editor` | Browser workbench: canvas, test bench and TypeScript source drawer |
| [`packages/create-wires`](./packages/create-wires) | `@pbzona/create-wires` | CLI and vanilla Vite starter |
| [`apps/workbench`](./apps/workbench) | `workbench-demo` (private) | Browser-only playground for trying the editor, ready to host on Vercel |
| [`apps/docs`](./apps/docs)           | `docs` (private)            | The [Mintlify](https://mintlify.com) documentation site                                  |

## Circuit workbench

[`@pbzona/wires-editor`](./packages/wires-editor) is a framework-neutral canvas editor.
[`@pbzona/create-wires`](./packages/create-wires) scaffolds a vanilla Vite app around it.
After `pnpm install`, run **`pnpm demo`** for the browser-only playground. It starts on a working half adder and resets on refresh. See [hosting the demo on Vercel](./apps/workbench/README.md#vercel).

For the local, file-saving starter, run **`pnpm workbench`** and open the URL it prints. This uses packed local libraries in a fresh temporary project; your chips stay there after you stop the server. See [checkout smoke test](./scripts/README.md).

Once the editor and initializer are published, the equivalent command is `npm create @pbzona/wires my-lab`.
The starter discovers named exports in `chips/` and `examples/`. **Save as chip** writes a new
readable TypeScript module in `chips/`, never an editor-only format or an overwrite of existing code.
On a static site, use **Source → Copy TypeScript** instead.

## Getting started

Requires Node.js 24, or 26 and later (Node 25 and anything older is end-of-life
and rejected), plus pnpm 11. `pnpm install` refuses to run on other versions.

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
| `pnpm build`             | Build the engine, editor and static demo to their `dist/` directories |
| `pnpm typecheck`         | Type-check the engine, editor and generated app template |
| `pnpm test`              | Test the engine, editor, scaffold and save behavior; type-check and run the docs examples |
| `pnpm lint`              | `docs`: `mint validate` and `mint broken-links`                                                              |
| `pnpm check`             | All of the above                                                                                             |
| `pnpm dev` / `pnpm docs` | `mint dev` for the docs site                                                                                 |

To run one package's tasks, filter by name:
`pnpm turbo run test --filter=@pbzona/wires`.

## Publishing

From the repository root, after installing dependencies:

```sh
pnpm release:dry-run   # build, check, pack, test a fresh scaffold, and preview npm publication
pnpm release           # repeat the checks and publish the verified archives to public npm
```

For a live release, commit the versions and changes you want to ship, use a clean worktree, and sign in to npm with publish access to `@pbzona`. Turbo follows the workspace dependencies: `@pbzona/wires` first, then `@pbzona/wires-editor`, then `@pbzona/create-wires`. The private root and docs packages are never published.

The release smoke test builds the starter from the exact tarballs in `dist/npm/`. Publication is never cached. If a release stops partway through, fix the issue and run `pnpm release` again: it skips an already-published version only when its tarball matches. Changed contents require a new version. When bumping versions, also check the editor's peer range and the starter template's library dependencies.
