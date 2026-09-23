import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// Bundles the real server modules for node so tests/server.mjs can drive the
// session_open hook and the RPC handlers against a fake OmniRoute.
export default defineConfig({
  root: here("./"),
  build: {
    ssr: here("./entry.ts"),
    outDir: here("../../node_modules/.cache/server-test"),
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { entryFileNames: "entry.mjs", format: "es" } },
  },
  logLevel: "warn",
});
