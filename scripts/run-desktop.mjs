import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] ?? "dev";
if (mode === "dev")
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("build-sidecar.mjs", import.meta.url)), "--debug"],
    { cwd: root, stdio: "inherit" },
  );
execFileSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
    ),
    mode,
    ...process.argv.slice(3),
  ],
  {
    cwd: fileURLToPath(new URL("../apps/desktop", import.meta.url)),
    stdio: "inherit",
  },
);
