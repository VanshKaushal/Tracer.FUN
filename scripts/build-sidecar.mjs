import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
const host = /host: (.+)/.exec(
  execFileSync("rustc", ["-vV"], { encoding: "utf8" }),
)[1];
const debug = process.argv.includes("--debug");
execFileSync(
  "cargo",
  ["build", ...(debug ? [] : ["--release"]), "-p", "trace-agent"],
  { stdio: "inherit" },
);
mkdirSync("apps/desktop/src-tauri/binaries", { recursive: true });
copyFileSync(
  `target/${debug ? "debug" : "release"}/trace-agent.exe`,
  `apps/desktop/src-tauri/binaries/trace-agent-${host}.exe`,
);
