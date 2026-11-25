# Circuit playground

A static Vite app that mounts the workspace editor with the standard chips. It opens on a wired half adder. Drive both inputs to `1` and run to stable: `sum` should be `0` and `carry` should be `1`. New circuits, wiring, stepping, and copying TypeScript all work. Reload to start over. There is no save endpoint, browser storage, login, or session service.

## Local

From the repository root, run `pnpm install` and `pnpm demo`. Turbo builds the simulator and editor before starting Vite. To preview the production site:

```sh
pnpm exec turbo run build --filter=workbench-demo
pnpm --filter workbench-demo preview
```

## Vercel

Import the `pbzona/wires` repository and set the project's **Root Directory** to `apps/workbench`. Use **Node.js 24.x** and enable **Include files outside the Root Directory in the Build Step** so Turbo can build the workspace libraries. The app's `vercel.json` selects Vite, installs the pinned pnpm workspace through Corepack, runs the filtered Turbo build, and serves `dist/`. The build puts a workspace-local Corepack shim first on `PATH`, so Turbo's package tasks use the same pnpm version as the install rather than Vercel's global pnpm. No environment variables or backend are needed.
