import { spawn } from "node:child_process";
import { createServer } from "node:net";
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    "apps/desktop/vite.config.ts",
    "--port",
    String(port),
  ],
  {
    env: { ...process.env, TRACE_BROWSER_PREVIEW: "1" },
    stdio: "ignore",
    windowsHide: true,
  },
);
let runner;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("UI test server exited before startup");
    try {
      ready = (await fetch(`http://127.0.0.1:${port}`)).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("UI test server did not become ready");
  runner = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    {
      env: {
        ...process.env,
        TRACE_UI_EXTERNAL_SERVER: "1",
        TRACE_UI_PORT: String(port),
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  if (runner?.exitCode === null) runner.kill();
  server.kill();
}
