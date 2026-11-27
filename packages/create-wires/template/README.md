# Your wires workbench

Use Node.js 24, or 26 and later. From this directory:

```sh
npm install
npm run dev
```

Open the **local** URL Vite prints. The canvas starts with `MyHalfAdder`. Set both inputs to `1` and click **Run to stable**: once settled, `sum` is `0` and `carry` is `1`. Try a different input and click **Step** to watch the gates propagate the change one tick at a time.

## Where circuits live

| Directory | In the palette | What to put here |
| --- | --- | --- |
| `chips/` | Mine | Your own named `gate()` or `circuit()` exports. `BufferGate.ts` is a small hand-written example. |
| `examples/` | Examples | Importable definitions to learn from. `Adder4.ts` chains four full adders. |
| `src/` | — | App setup. `palette.ts` discovers your `.ts` files and the exports from `@pbzona/wires/components`. |

Export multiple named definitions from a file if you like. Vite imports these modules into the browser, so keep demos and other top-level side effects elsewhere. Changes in either library folder refresh the palette without remounting the editor.

Create a draft, place components and connect its inputs and outputs. The source drawer contains plain TypeScript: components use ordinary imports, not editor IDs. **Save as chip** creates a new `chips/Name.ts`; the name must match the exported binding exactly. Use only letters, digits or underscores (not a leading digit), and avoid reserved JS and platform names. A conflict is an error, not an edit. To edit an existing file, use your text editor. To reuse a chip in another chip:

```ts
import { BufferGate } from "./BufferGate.ts";
```

Keep the `.ts` extension on local imports so both Vite and Node.js 24 can resolve the source file directly. From a chip in `chips/`, import the four-bit adder from `../examples/Adder4.ts`.

## Saving and sharing

Keep the dev server on your own machine. Its local save route accepts only same-origin JSON POSTs from a loopback connection, at most 128 KiB per request. It refuses paths, symlinks and overwrites. Don't expose the development server through a proxy or tunnel. Only add code you trust: the browser runs every discovered chip module.

```sh
npm run build
npm run preview
```

Deploy `dist/` to a static host to share the workbench. Preview and the static build let you **Copy TypeScript**, but cannot write files on the host. No backend or credentials are needed.
