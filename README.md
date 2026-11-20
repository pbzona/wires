# wires

Build digital logic from a single NAND gate up, then simulate and inspect it,
in TypeScript.

This is a [Turborepo](https://turborepo.com) monorepo managed with pnpm.

| Path | Package | Description |
|---|---|---|
| [`packages/wires`](./packages/wires) | `wires` | The library: engine (`wires`) and standard components (`wires/components`) |
| [`apps/docs`](./apps/docs) | `docs` (private) | The [Mintlify](https://mintlify.com) documentation site |

## Getting started

Requires Node.js ≥ 22.18 and < 25 (the Mintlify CLI doesn't support Node 25),
plus pnpm 11.

```sh
pnpm install
pnpm check   # typecheck, test, build and lint every package
pnpm docs    # docs preview at http://localhost:3000
```

## Tasks

All root scripts run through `turbo`, which caches results and builds `wires`
before anything that depends on it.

| Command | What it runs |
|---|---|
| `pnpm build` | `wires`: compile to `dist/` |
| `pnpm typecheck` | `wires`: `tsc` over src, tests and examples |
| `pnpm test` | `wires`: Vitest. `docs`: type-check and run every code example in the docs against the built library |
| `pnpm lint` | `docs`: `mint validate` and `mint broken-links` |
| `pnpm check` | All of the above |
| `pnpm dev` / `pnpm docs` | `mint dev` for the docs site |

To run one package's tasks, filter by name:
`pnpm turbo run test --filter=wires`.

## Docs deployment

The docs site is the `apps/docs` folder, the one containing `docs.json`. In
Mintlify's Git settings, enable **docs.json is in a subdirectory** and set the
path to `/apps/docs`.
