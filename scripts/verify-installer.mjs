// Run only on a disposable GitHub Windows runner. Never installs into a user's PC.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pipeCall } from "./local-collector.mjs";

assert.equal(process.platform, "win32");
assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "Installer QA requires a disposable CI machine",
);
assert.ok(process.env.RUNNER_TEMP);
const setup = resolve(process.argv[2]);
const root = join(process.env.RUNNER_TEMP, `Trace-install-${process.pid}`);
const install = join(root, "app");
const data = join(root, "data");
mkdirSync(data, { recursive: true });
const env = {
  ...process.env,
  LOCALAPPDATA: data,
  TRACE_INSTANCE: `install-${process.pid}`,
};
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
const pipe = `\\\\.\\pipe\\Trace-${sid}-${env.TRACE_INSTANCE}`;
const call = (command, args) =>
  pipeCall(pipe, args === undefined ? { command } : { command, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (exe, args) =>
  execFileSync(exe, args, {
    env,
    windowsHide: true,
    timeout: 120000,
    stdio: "inherit",
  });
async function until(check, description) {
  for (let n = 0; n < 100; n++) {
    try {
      if (await check()) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(description);
}
function installPackage() {
  run(setup, ["/S", `/D=${install}`]);
  assert.ok(existsSync(join(install, "trace.exe")), "Dashboard is installed");
  assert.ok(
    existsSync(join(install, "trace-agent.exe")),
    "Collector is bundled",
  );
}
let gui;
async function launch() {
  gui = spawn(join(install, "trace.exe"), ["--show-all"], {
    env,
    windowsHide: false,
    stdio: "inherit",
  });
  let failure;
  gui.once("error", (e) => {
    failure = e;
  });
  await until(async () => {
    if (failure) throw failure;
    return await call("GetStatus");
  }, "The installed dashboard did not start its collector");
  assert.equal(gui.exitCode, null, "Dashboard stays running");
  // Pass C# through EncodedCommand: Windows PowerShell's command-line quote
  // handling otherwise strips the quotes from DllImport attributes.
  const windows = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices; public class TraceWindowCheck {
    public delegate bool Callback(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Callback f, IntPtr p);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    public static string[] Titles(uint process) { var names = new List<string>(); EnumWindows((h,p)=>{uint owner; GetWindowThreadProcessId(h,out owner); if(owner==process){var text=new StringBuilder(512);GetWindowText(h,text,512);if(text.Length>0)names.Add(text.ToString());}return true;},IntPtr.Zero);return names.ToArray(); }
  }'; ConvertTo-Json -Compress -InputObject @([TraceWindowCheck]::Titles(${gui.pid}))`;
  let titles = [],
    windowError = "";
  await until(() => {
    try {
      titles = JSON.parse(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(windows, "utf16le").toString("base64"),
          ],
          { windowsHide: true, encoding: "utf8", stdio: "pipe" },
        ).trim(),
      );
      return (
        titles.includes("Trace Bar") &&
        titles.some((t) => t === "Trace" || t.endsWith("| Trace"))
      );
    } catch (error) {
      windowError = String(error.stderr ?? error);
      return false;
    }
  }, "Both Trace and Trace Bar windows must exist").catch((error) => {
    console.error({ titles, windowError });
    throw error;
  });
  console.log("Installed windows:", titles);
}
async function uninstall() {
  const name = readdirSync(install).find((n) => /uninstall.*\.exe$/i.test(n));
  assert.ok(name, "Uninstaller exists");
  run(join(install, name), ["/S"]);
  await until(
    () => !existsSync(join(install, "trace.exe")),
    "Uninstall must remove the dashboard",
  );
  await until(
    () => !existsSync(join(install, "trace-agent.exe")),
    "Uninstall must stop and remove the collector",
  );
  assert.ok(
    existsSync(join(data, "Trace", "trace.db")),
    "Uninstall preserves history",
  );
}
try {
  installPackage();
  await launch();
  const initial = await call("GetSettings");
  assert.equal(
    initial.tracking_enabled,
    false,
    "New installations require consent",
  );
  assert.equal(initial.launch_at_login, false, "Startup is opt-in");
  await call("SaveSettings", {
    settings: {
      ...initial,
      onboarding_complete: true,
      tracking_enabled: true,
      distance_unit: "cm",
    },
  });
  await call("StartFocus");
  await sleep(250);
  await call("EndFocus");
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const sessions = () =>
    call("GetFocusSessions", { range: { start: date, end: date } });
  assert.equal((await sessions()).length, 1);
  installPackage(); // Upgrade while the host and collector are both running.
  await launch();
  assert.equal(
    (await call("GetSettings")).distance_unit,
    "cm",
    "Upgrade keeps preferences",
  );
  assert.equal((await sessions()).length, 1, "Upgrade keeps history");
  await uninstall();
  installPackage();
  await launch();
  assert.equal(
    (await call("GetSettings")).distance_unit,
    "cm",
    "Reinstall restores preferences",
  );
  assert.equal((await sessions()).length, 1, "Reinstall restores history");
  // Keep both processes running so the package must perform its own shutdown.
  await uninstall();
  console.log(
    "Installer lifecycle passed: install, automatic collector startup, both windows, consent, running upgrade, uninstall and history recovery.",
  );
} finally {
  try {
    await call("Stop");
  } catch {}
  if (gui?.exitCode === null) gui.kill();
}
