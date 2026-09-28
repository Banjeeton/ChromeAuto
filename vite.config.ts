import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const sidePanelRoot = resolve(projectRoot, "src/sidepanel");

export default defineConfig({
  root: sidePanelRoot,
  base: "./",
  publicDir: resolve(projectRoot, "public"),
  plugins: [react()],
  // WorkerNavigator does not expose the deprecated appVersion property.
  // playwright-crx reads it through its bundled Node `os.release()` shim.
  define: {
    "navigator.appVersion": "navigator.userAgent"
  },
  build: {
    outDir: resolve(projectRoot, "dist"),
    emptyOutDir: true,
    target: "chrome116",
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(sidePanelRoot, "index.html"),
        background: resolve(projectRoot, "src/background/service-worker.ts"),
        playwrightRuntime: resolve(
          projectRoot,
          "src/adapters/playwright/playwright-engine.ts"
        ),
        content: resolve(projectRoot, "src/content/content-script.ts")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") {
            return "background/service-worker.js";
          }

          if (chunk.name === "playwrightRuntime") {
            return "background/playwright-engine.js";
          }

          if (chunk.name === "content") {
            return "content/content-script.js";
          }

          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
