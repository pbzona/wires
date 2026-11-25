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
| [`apps/docs`](./apps/docs)           | `docs` (private)            | The [Mintlify](https://mintlify.com) documentation site                                  |

## Circuit workbench

[`@pbzona/wires-editor`](./packages/wires-editor) is a framework-neutral canvas editor.
[`@pbzona/create-wires`](./packages/create-wires) scaffolds a vanilla Vite app around it.
To try the unpublished packages from this checkout, run `pnpm install` and **`pnpm workbench`**.
Open the local URL it prints. This uses packed local libraries in a fresh temporary project;
your chips stay there after you stop the server. See [checkout smoke test](./scripts/README.md).

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
| `pnpm build`             | Compile the engine and editor to `dist/` |
| `pnpm typecheck`         | Type-check the engine, editor and generated app template |
| `pnpm test`              | Test the engine, editor, scaffold and save behavior; type-check and run the docs examples |
| `pnpm lint`              | `docs`: `mint validate` and `mint broken-links`                                                              |
| `pnpm check`             | All of the above                                                                                             |
| `pnpm dev` / `pnpm docs` | `mint dev` for the docs site                                                                                 |

To run one package's tasks, filter by name:
`pnpm turbo run test --filter=@pbzona/wires`.

## Publishing

Only `@pbzona/wires`, `@pbzona/wires-editor`, and `@pbzona/create-wires` are publishable. The workspace root, docs, and generated app are private. All three public manifests target `https://registry.npmjs.org/` with public access.

**Prepare from the repository root.** Check that the versions you intend to release are unused on npm. For a later release, also check the editor's `@pbzona/wires` peer range and both dependency ranges in `packages/create-wires/template/package.json`. Use pnpm to pack: it replaces `workspace:` references in the tarballs with real versions. Both libraries clean and rebuild `dist/` during packing.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm -r --filter '@pbzona/*' pack --pack-destination "$PWD/dist/npm"
node scripts/smoke-starter.mjs --tarballs dist/npm
```

The smoke test scaffolds, installs, type-checks and builds a Vite app from those exact tarballs without publishing. Preview npm's publish operation for each archive (example for `0.1.0`):

```sh
npm publish ./dist/npm/pbzona-wires-0.1.0.tgz --dry-run --access public --registry=https://registry.npmjs.org/
npm publish ./dist/npm/pbzona-wires-editor-0.1.0.tgz --dry-run --access public --registry=https://registry.npmjs.org/
npm publish ./dist/npm/pbzona-create-wires-0.1.0.tgz --dry-run --access public --registry=https://registry.npmjs.org/
```

**Release only after review.** Ensure the tested source is committed, sign in with a publish-capable `@pbzona` account, and run the same three commands **without `--dry-run`**, in the order shown. Publish the initializer last so `npm create @pbzona/wires` never scaffolds an app that references unpublished libraries. npm will not let you reuse a published name/version. No credentials belong in this repository.
