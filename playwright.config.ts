import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui",
  use: {
    baseURL: `http://127.0.0.1:${process.env.TRACE_UI_PORT ?? "1422"}`,
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer:
    process.env.TRACE_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          command:
            "node node_modules/vite/bin/vite.js --config apps/desktop/vite.config.ts --port 1422",
          env: { TRACE_BROWSER_PREVIEW: "1" },
          url: "http://127.0.0.1:1422",
          reuseExistingServer: false,
        },
  reporter: "list",
  outputDir: "test-results",
});
