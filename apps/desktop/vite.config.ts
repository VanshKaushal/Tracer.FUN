import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
// @ts-ignore Node module shared with the pipe integration tests.
import { localCollector } from "../../scripts/local-collector.mjs";
export default defineConfig(({ command, mode }) => {
  const bridge = localCollector(
    fileURLToPath(new URL("../../", import.meta.url)),
    command === "serve" &&
      mode !== "test" &&
      process.platform === "win32" &&
      process.env.TRACE_BROWSER_PREVIEW !== "1",
  );
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [react(), bridge.plugin],
    define: { __TRACE_LOCAL_TOKEN__: JSON.stringify(bridge.token) },
    clearScreen: false,
    server: { host: "127.0.0.1", port: 1420, strictPort: true },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          dashboard: fileURLToPath(new URL("./index.html", import.meta.url)),
          bar: fileURLToPath(new URL("./trace-bar.html", import.meta.url)),
        },
        output: {
          manualChunks: {
            charts: [
              "echarts/core",
              "echarts/charts",
              "echarts/components",
              "echarts/renderers",
            ],
          },
        },
      },
    },
    test: { include: ["src/**/*.test.ts"] },
  };
});
