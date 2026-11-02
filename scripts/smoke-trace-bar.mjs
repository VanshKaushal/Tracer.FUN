// Isolated Windows command/event-channel smoke test. Never connects to the user's collector.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import assert from "node:assert/strict";
import { pipeCall } from "./local-collector.mjs";
if (process.platform !== "win32")
  throw new Error("This check requires Windows");
const sid = execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  ],
  { encoding: "utf8", windowsHide: true },
).trim();
const instance = `bar-smoke-${process.pid}`;
const pipe = `\\\\.\\pipe\\Trace-${sid}-${instance}`;
const root = mkdtempSync(join(process.cwd(), ".trace-bar-smoke-"));
const exe =
  process.argv[2] ?? join(process.cwd(), "target", "debug", "trace-agent.exe");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const call = (command, args) =>
  pipeCall(pipe, args === undefined ? { command } : { command, args });
let child, stream;
let last,
  buffer = Buffer.alloc(0),
  streamError;
async function start() {
  child = spawn(exe, ["--no-bar"], {
    env: { ...process.env, TRACE_INSTANCE: instance, LOCALAPPDATA: root },
    windowsHide: true,
    stdio: "inherit",
  });
  let failure;
  child.once("error", (e) => (failure = e));
  for (let i = 0; i < 60; i++) {
    if (failure) throw failure;
    try {
      await call("GetStatus");
      return;
    } catch {}
    await sleep(100);
  }
  throw new Error("Isolated collector did not start");
}
async function connect() {
  last = null;
  buffer = Buffer.alloc(0);
  streamError = null;
  stream = createConnection(`${pipe}-Live`);
  stream.on("error", (e) => (streamError = e));
  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      assert.ok(size < 65536, "Live frame must remain small");
      if (buffer.length < size + 4) return;
      last = JSON.parse(buffer.subarray(4, size + 4));
      buffer = buffer.subarray(size + 4);
    }
  });
  return frame((l) => !!l);
}
async function frame(predicate) {
  for (let i = 0; i < 100; i++) {
    if (streamError) throw streamError;
    if (last && predicate(last)) return last;
    await sleep(50);
  }
  throw new Error("Expected live state was not pushed");
}
function move() {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class TraceBarSmoke { [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, System.UIntPtr extra); }'; $point = New-Object TraceBarSmoke+P; [void][TraceBarSmoke]::GetCursorPos([ref]$point); try { 1..5 | ForEach-Object { [TraceBarSmoke]::mouse_event(1, 8, 0, 0, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [TraceBarSmoke]::mouse_event(1, -8, 0, 0, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 40 } } finally { [void][TraceBarSmoke]::SetCursorPos($point.X, $point.Y) }`,
    ],
    { windowsHide: true, stdio: "inherit" },
  );
}
try {
  await start();
  const defaults = await call("GetSettings");
  await call("SaveSettings", {
    settings: {
      ...defaults,
      tracking_enabled: true,
      onboarding_complete: true,
      trace_bar: { ...defaults.trace_bar, launch_with_trace: false },
    },
  });
  await connect();
  await frame((l) => l.tracking);
  await call("StartFocus");
  await frame((l) => !!l.focus);
  move();
  await sleep(200);
  assert.ok((await call("GetLiveStats")).focus.stats.distance_px > 0);
  await call("Pause", { duration_seconds: 900 });
  await frame((l) => l.paused && !l.tracking);
  await call("Resume");
  await frame((l) => l.tracking && !l.paused);
  await call("EndFocus");
  await frame((l) => !!l.completed_focus && !l.focus);
  await call("SetIncognito", { enabled: true });
  const privacy = await frame((l) => l.incognito && !l.tracking);
  const before = privacy.today.distance_px;
  move();
  await sleep(1200);
  assert.equal(
    (await call("GetLiveStats")).today.distance_px,
    before,
    "Incognito must ignore movement",
  );
  await call("SetIncognito", { enabled: false });
  await frame((l) => !l.incognito && l.tracking);
  const bar = await call("GetBarSettings");
  await call("SetBarSettings", {
    settings: { ...bar, edge: "bottom", offset: 0.3, monitor: "DISPLAY-TEST" },
  });
  await frame((l) => l.settings.trace_bar.edge === "bottom");
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const range = { start: date, end: date };
  assert.equal((await call("GetFocusSessions", { range })).length, 1);
  stream.destroy();
  assert.equal(
    (await call("GetStatus")).tracking,
    true,
    "Closing the event client must leave tracking alive",
  );
  await call("Stop");
  await new Promise((resolve) => child.once("exit", resolve));
  await start();
  assert.equal((await call("GetBarSettings")).edge, "bottom");
  assert.equal((await call("GetFocusSessions", { range })).length, 1);
  await call("Pause", { duration_seconds: null });
  await call("DeleteAll");
  assert.equal((await call("GetFocusSessions", { range })).length, 0);
  console.log(
    `Trace Bar live IPC, privacy, focus, restart, settings and deletion passed. Isolated data: ${root}`,
  );
} finally {
  stream?.destroy();
  try {
    await call("Stop");
  } catch {}
  if (child?.exitCode === null) {
    await sleep(300);
    if (child.exitCode === null) child.kill();
  }
}
