import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests import the library by its package name so they only touch the public API.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@pbzona\/wires\/components$/, replacement: fileURLToPath(new URL("./src/components/index.ts", import.meta.url)) },
      { find: /^@pbzona\/wires$/, replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
