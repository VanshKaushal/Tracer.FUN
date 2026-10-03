// Live Windows hook/IPC/persistence check using an isolated data directory.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { pipeCall } from "./local-collector.mjs";

if (process.platform !== "win32")
  throw new Error("This check requires Windows.");
const sid = execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  ],
  { encoding: "utf8", windowsHide: true },
).trim();
const pipe = `\\\\.\\pipe\\Trace-${sid}`;
try {
  await pipeCall(pipe, { command: "GetStatus" });
  throw new Error(
    "Stop the existing collector from the tray before running the isolated smoke check.",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const directory = mkdtempSync(join(process.cwd(), ".trace-smoke-"));
const exe = join(process.cwd(), "dist", "trace-agent.exe");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let server;
let browser;
const start = async () => {
  child = spawn(exe, [], {
    env: { ...process.env, LOCALAPPDATA: directory },
    windowsHide: true,
    stdio: "inherit",
  });
  let failure;
  child.on("error", (error) => {
    failure = error;
  });
  for (let i = 0; i < 50; i++) {
    if (failure) throw failure;
    try {
      return await pipeCall(pipe, { command: "GetStatus" });
    } catch {}
    await sleep(100);
  }
  throw new Error("Isolated collector did not start.");
};
const call = (command, args) =>
  pipeCall(pipe, args === undefined ? { command } : { command, args });
try {
  assert.equal((await start()).tracking, false);
  const settings = await call("GetSettings");
  assert.equal(settings.launch_at_login, false);
  await call("SaveSettings", {
    settings: {
      ...settings,
      tracking_enabled: true,
      onboarding_complete: true,
    },
  });
  assert.equal((await call("GetStatus")).tracking, true);
  // Move the pointer slightly and back through Win32, exercising the global hook.
  await sleep(150);
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class TraceSmokePointer { [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, System.UIntPtr extra); }'; 1..20 | ForEach-Object { [TraceSmokePointer]::mouse_event(1, 2, 0, 0, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 20; [TraceSmokePointer]::mouse_event(1, -2, 0, 0, [System.UIntPtr]::Zero); Start-Sleep -Milliseconds 20 }`,
    ],
    { windowsHide: true, stdio: "inherit" },
  );
  await sleep(250);
  const today = await call("GetToday");
  assert.ok(
    today.daily.reduce((sum, day) => sum + day.stats.distance_px, 0) > 0,
    "Global pointer movement must reach persisted metrics",
  );
  assert.ok(today.heatmap.length > 0);
  assert.ok(today.sessions.length > 0);
  await call("Pause", { duration_seconds: 900 });
  assert.equal((await call("GetStatus")).tracking, false);
  await call("Resume");
  assert.equal((await call("GetStatus")).tracking, true);
  const date = today.daily[0].date;
  const range = { start: date, end: date };
  const exported = await call("Export", { format: "json", range });
  assert.ok(JSON.parse(exported["trace.json"]));
  assert.ok(
    (await call("Export", { format: "csv", range }))["daily.csv"].includes(
      date,
    ),
  );
  await call("Stop");
  await sleep(600);
  await start();
  assert.equal((await call("GetSettings")).tracking_enabled, true);
  assert.ok((await call("GetToday")).daily.length > 0);
  if (process.argv.includes("--browser")) {
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(
      process.cwd(),
      ".browser-cache",
    );
    const { chromium, expect } = await import("@playwright/test");
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--config",
        "apps/desktop/vite.config.ts",
        "--port",
        "1421",
      ],
      {
        env: {
          ...process.env,
          LOCALAPPDATA: directory,
          TRACE_BROWSER_PREVIEW: "0",
        },
        windowsHide: true,
        stdio: "ignore",
      },
    );
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch("http://127.0.0.1:1421")).ok) break;
      } catch {}
      await sleep(100);
    }
    const denied = await fetch("http://127.0.0.1:1421/__trace", {
      method: "POST",
      body: JSON.stringify({ command: "GetStatus" }),
    });
    assert.equal(denied.status, 403);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto("http://127.0.0.1:1421");
    await expect(page.getByText("Tracking on", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".hero-copy h2 span")).not.toHaveText("0");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page
      .getByRole("button", { name: "Until resumed", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByText("Tracking on", { exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await (await download).saveAs(join(directory, "browser-export.json"));
    for (const label of [
      "Activity",
      "Movement",
      "Clicks",
      "Heatmap",
      "Sessions",
      "History",
      "Insights",
      "Settings",
    ]) {
      await page
        .getByRole("navigation")
        .getByRole("link", { name: label, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: label, exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("switch", { name: "Enable interaction tracking" })
      .click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Tracking off", { exact: true })).toBeVisible();
    await page
      .getByRole("switch", { name: "Enable interaction tracking" })
      .click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Tracking on", { exact: true })).toBeVisible();
    await page.goto("http://127.0.0.1:1421");
    await expect(page.getByText("Tracking on", { exact: true })).toBeVisible();
    await page.screenshot({
      path: join(directory, "browser.png"),
      fullPage: true,
    });
    console.log(
      "PASS: real local browser connection, controls, settings, export download, navigation and unauthorized-request rejection.",
    );
    await browser.close();
    browser = undefined;
    server.kill();
    server = undefined;
  }
  await call("Pause", { duration_seconds: null });
  await call("DeleteRange", { range });
  assert.equal((await call("GetToday")).daily.length, 0);
  console.log(
    "PASS: global hook, settings, movement, heatmap, sessions, pause/resume, JSON/CSV, restart persistence, date deletion.",
  );
  console.log(`Isolated test data: ${directory}`);
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
  try {
    await call("Stop");
  } catch {}
  await sleep(300);
  if (child && child.exitCode === null) child.kill();
}
