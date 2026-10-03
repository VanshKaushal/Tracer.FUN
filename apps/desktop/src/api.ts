import { invoke, isTauri } from "@tauri-apps/api/core";
declare const __TRACE_LOCAL_TOKEN__: string;
export const nativeDesktop = isTauri();
export const localBrowser = !nativeDesktop && !!__TRACE_LOCAL_TOKEN__;
export const desktop = nativeDesktop || localBrowser;
let connection: Promise<unknown> | undefined;
function connectDesktop() {
  return (connection ??= invoke("restart_collector").catch((error) => {
    connection = undefined;
    throw error;
  }));
}
export async function call<T>(command: string, args?: unknown): Promise<T> {
  if (!desktop)
    throw new Error(
      "Live telemetry is available in the Windows desktop app. This browser preview has no collector connection.",
    );
  if (localBrowser) {
    const response = await fetch("/__trace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Trace-Token": __TRACE_LOCAL_TOKEN__,
      },
      body: JSON.stringify(
        args === undefined ? { command } : { command, args },
      ),
    });
    const result = await response.json();
    if (!response.ok || result.error)
      throw new Error(result.error || "Collector unavailable.");
    return result.data as T;
  }
  await connectDesktop();
  return invoke<T>("collector", {
    request: args === undefined ? { command } : { command, args },
  });
}
export async function exportData(
  format: string,
  range: { start: string; end: string },
) {
  if (!desktop)
    throw new Error("Open the Windows desktop app to export your local data.");
  if (localBrowser) {
    const files = await call<Record<string, string>>("Export", {
      format,
      range,
    });
    for (const [name, contents] of Object.entries(files)) {
      if (
        ![
          "trace.json",
          "daily.csv",
          "sessions.csv",
          "minute_stats.csv",
        ].includes(name)
      )
        throw new Error("Invalid export filename.");
      const url = URL.createObjectURL(
        new Blob([contents], {
          type: name.endsWith("json") ? "application/json" : "text/csv",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    return "your browser downloads (allow multiple downloads for CSV)";
  }
  if (!(await invoke<boolean>("choose_export_folder"))) return null;
  return invoke<string>("export_files", {
    request: { command: "Export", args: { format, range } },
  });
}
export const restart = () => {
  connection = undefined;
  return localBrowser ? call("Reconnect") : connectDesktop();
};
