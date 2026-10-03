import { execFileSync } from "node:child_process";
import { pipeCall } from "./local-collector.mjs";
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
const pipe = `\\\\.\\pipe\\Trace-${sid}`;
const status = await pipeCall(pipe, { command: "GetStatus" });
const settings = await pipeCall(pipe, { command: "GetSettings" });
const today = await pipeCall(pipe, { command: "GetToday" });
console.log(
  JSON.stringify(
    {
      status,
      settings,
      recorded_days_today: today.daily.length,
      heatmap_cells: today.heatmap.length,
      sessions: today.sessions.length,
    },
    null,
    2,
  ),
);
