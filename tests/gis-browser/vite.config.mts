import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  envDir: false,
  esbuild: { jsx: "automatic" },
  server: {
    host: "127.0.0.1",
    port: 5184,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
