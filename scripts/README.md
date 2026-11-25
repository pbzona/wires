# Smoke-test the starter from a checkout

Use Node 24 or 26+, pnpm 11, and `tar`. With checkout dependencies already installed,
first build the libraries (or use their just-built `dist/` directories):

```sh
pnpm --filter @pbzona/wires build
pnpm --filter @pbzona/wires-editor build
node scripts/smoke-starter.mjs
```

The script packs `wires`, `wires-editor`, and `create-wires` **without** running
prepack/build again. It runs the packed CLI's `bin/create-wires.js my-lab` in a
fresh OS temp directory. Only in the generated `package.json`, it replaces the
two library dependencies with local tarballs. This tests the published file
layout rather than workspace links; the editor gets the app's copy of `wires`.
Nothing is installed into the checkout, linked globally, or published.

Installation uses `pnpm install --offline` by default. If the pnpm store lacks
starter tooling, rerun with `--online` to allow pnpm to fetch missing external
dependencies. Neither mode downloads the editor or CLI. The smoke test checks
that the app and editor resolve one `wires`, imports and elaborates the generated
`examples/Adder4.ts` without demo output, runs `tsc --noEmit`, and builds the
production Vite site. On success it removes only its new temp directory; on
failure it prints the retained directory for inspection.

To verify already-packed release artifacts instead of packing the checkout again, pass `--tarballs dist/npm`. The directory must contain the three default pnpm tarball filenames for the versions in the manifests. See the root [publishing checklist](../README.md#publishing).

## Open the workbench

```sh
node scripts/smoke-starter.mjs --dev
```

After the same checks, open `http://127.0.0.1:5173` for a manual demo or browser
smoke. Try changing a half-adder input and stepping the simulation. Place the
four-bit adder from Examples and double-click it to look inside. Vite binds only to loopback and reports an error
if port 5173 is occupied. Ctrl-C stops it; the printed temp directory is kept,
including any demo chips you saved. Remove it yourself when finished.
