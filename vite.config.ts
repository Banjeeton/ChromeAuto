import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const sidePanelRoot = resolve(projectRoot, "src/sidepanel");

function rejectDynamicServiceWorkerImports(): Plugin {
  return {
    name: "reject-dynamic-service-worker-imports",
    generateBundle(_options, bundle) {
      const serviceWorker = Object.values(bundle).find(
        (output) =>
          output.type === "chunk" &&
          output.isEntry &&
          output.name === "background"
      );

      if (serviceWorker?.type !== "chunk") {
        this.error("The MV3 service worker entry was not emitted.");
        return;
      }

      const pending = [serviceWorker.fileName];
      const visited = new Set<string>();

      while (pending.length > 0) {
        const fileName = pending.pop();
        if (fileName === undefined || visited.has(fileName)) {
          continue;
        }
        visited.add(fileName);

        const chunk = bundle[fileName];
        if (chunk?.type !== "chunk") {
          continue;
        }

        if (chunk.dynamicImports.length > 0) {
          this.error(
            `The MV3 service worker graph must not contain dynamic import(); found one in ${fileName}. Use static ESM imports instead.`
          );
        }

        pending.push(...chunk.imports);
      }
    }
  };
}

export default defineConfig({
  root: sidePanelRoot,
  base: "./",
  publicDir: resolve(projectRoot, "public"),
  plugins: [react(), rejectDynamicServiceWorkerImports()],
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
