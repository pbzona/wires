# @pbzona/create-wires

Create a vanilla TypeScript + Vite circuit workbench. Use Node.js 24, or 26 and later:

```sh
npm create @pbzona/wires
cd my-lab
npm install
npm run dev
```

The default directory is `my-lab`. To choose a different new or **empty** directory, pass it as an argument (`.` also works). The command only copies files: it won't install dependencies, start a server, or overwrite anything. Open the local URL printed by Vite.

The generated project is yours to edit. Named `gate()` and `circuit()` exports in `chips/` and `examples/` join the standard components on the editor palette. Saving a new chip locally creates ordinary TypeScript in `chips/`, never modifying an existing file. `npm run build` produces a static, copy-only workbench in `dist/`.

See the `README.md` in your generated project for the first circuit, file layout and local save rules.
