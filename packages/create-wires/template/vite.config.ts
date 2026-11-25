import { defineConfig } from "vite";
import { saveChip } from "./dev/save-chip.ts";

export default defineConfig({
  server: { host: "127.0.0.1" },
  plugins: [{
    name: "local-chip-library",
    apply: "serve",
    // No configurePreviewServer hook: preview and static builds are copy-only.
    configureServer(server) {
      server.middlewares.use(saveChip(server.config.root));
    },
  }],
});
