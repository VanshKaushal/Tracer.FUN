# Trace

A Windows 10/11 desktop utility for local pointer interaction analytics, implemented from [prd.md](prd.md) and [trd.md](trd.md).

The Rust collector and Tauri dashboard are separate executables. Closing the dashboard releases its WebView and leaves the collector running. The collector captures only pointer events; it does not read keyboard input, screen pixels, clipboard contents, URLs, window titles, or documents. The packaged desktop app has no network listener or remote analytics. Local browser development uses a loopback-only bridge to the same Windows named pipe.

## Run

For a packaged build, keep all files from `dist` together (`trace.exe`, `trace-agent.exe` and the cross-build's `WebView2Loader.dll`) and launch `trace.exe`, or use the Windows installer in `dist`. Microsoft Edge WebView2 Runtime is required by the dashboard. Tracking and launch-at-login are initially disabled; the first-run screen asks you to enable them. The tray exposes pause/resume, dashboard/settings, and **Stop Trace completely**.

For development, install Node.js 22+ and Rust stable with the Windows MSVC toolchain, Visual Studio C++ Build Tools, Windows SDK, and WebView2 Runtime:

```powershell
npm ci
npm run desktop
```

The desktop command builds the collector sidecar before launching Tauri and Vite. To use the dashboard in your local Windows browser:

```powershell
npm run dev
```

Open `http://127.0.0.1:1420`. On Windows, the development server starts `dist/trace-agent.exe` (or the debug collector) and connects to your real local data. Enable **Enable interaction tracking** on the welcome screen, then save. If you already completed welcome with tracking off, enable it in Settings and click **Save preferences**. Use your pointer, click, and scroll; the dashboard refreshes every three seconds. Browser exports go to Downloads; allow multiple downloads for CSV. Desktop exports use a folder picker.

For local testing without Rust tools, launch `dist/trace.exe` with `trace-agent.exe` and `WebView2Loader.dll` beside it. Both the browser and desktop use `%LOCALAPPDATA%\Trace\trace.db`, so they show the same history. Closing either dashboard leaves the collector running; stop it using the tray's **Stop Trace completely** action.

`TRACE_BROWSER_PREVIEW=1` disables the development bridge. Non-Windows browsers and static production previews remain unconnected. The bridge exists only during `npm run dev`; publishing the static dashboard does not enable global pointer tracking on other computers. The Windows app must run locally on each user's computer.

## Build and check

```powershell
npm run build
npm test
cargo test
cargo run --release -p trace-agent -- --simulate
npx playwright install chromium
npm run test:ui
npm run test:bridge
npm run test:windows
node scripts/smoke-windows.mjs --browser
npm run installer
```

`test:windows` requires the portable collector in `dist` and no existing collector running. It uses an isolated workspace data directory, briefly moves the pointer and returns it, and checks the real Windows hook, persistence, controls, exports and deletion. It leaves the isolated test database for inspection and stops its collector afterward. Add `--browser` as shown above to also verify the real browser connection and export download; the cached Playwright browser is required. `npm run status` reports collector status and saved settings.

The normal Windows installer uses Tauri's current-user NSIS configuration, bundles the collector, and supports WebView2 installation. A container cross-build fallback is provided in `scripts/build-windows-container.sh`, with a simpler current-user NSIS installer in `scripts/installer.nsi`. The fallback requires an existing WebView2 Runtime. It produces both Windows executables and `dist/Trace-0.1.0-setup.exe`; it does not sign them.

## Implementation

| Component       | Responsibility                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `trace-agent`   | Minimal Win32 mouse-hook callback, bounded queue, worker, monitor enumeration, tray, startup, suspend/lock handling, local rotated logs                      |
| `trace-core`    | Pointer types, validated settings, typed aggregate contract, calendar boundaries                                                                             |
| `trace-metrics` | Exact transient segment distance, sampled speed, clicks/double clicks, drags, scroll bursts, active/idle sessions, dwell heatmaps, click-to-click efficiency |
| `trace-storage` | Versioned SQLite migration, WAL, transactional batches, crash recovery, history, baselines, records, weekly totals, exports, deletion, retention             |
| `trace-ipc`     | Bounded framed JSON over a current-user SID-scoped named pipe, user-only ACL, remote clients rejected                                                        |
| `apps/desktop`  | React/TypeScript dashboard, ECharts, all nine routes, date/monitor/event filters, consent, settings, local export-folder selection                           |

Data lives at `%LOCALAPPDATA%\Trace\trace.db`. The collector flushes every ten seconds or when a buffer limit is reached. SQLite locks retain the pending batch for retry. Prolonged storage failure pauses collection before the buffer can grow without bound; the dashboard reports the error. Raw click/drag retention is 1–24 hours, enforced by a minute-level cleanup while the collector runs. Minute data expires after 7–30 days; hourly, daily, session and heatmap aggregates remain until deletion.

The database stores sparse typed JSON aggregates and exposes the TRD's metric columns as SQLite generated columns. Histogram bins and efficiency sums support bounded-memory historical analytics. Session-day fragments preserve unaffected activity when deleting dates from a session spanning midnight. Schema version 1 is initialized transactionally; unknown versions are rejected.

Choose **Distance unit** beside the date filter to display cursor travel in pixels, millimeters, centimeters, meters, kilometers, inches, feet, yards, or miles. This also updates speed, drag distance, charts, session/history tables, and insights. The desktop app saves the choice automatically; it is also available in Settings under Display & retention.

Scroll steps are absolute native wheel delta divided by 120, with signed vertical/horizontal deltas preserved. Pixels are canonical for distance, including transitions between known monitors in the virtual desktop; physical units are labeled estimates and use display scaling DPI (96 DPI fallback for multiple displays), not measured panel dimensions or mouse travel on the desk. Speed percentiles are approximate logarithmic histogram values. Display-layout changes, sleep and resume reset movement anchors. Overload counters expose missing movement events; button events have reserved queue capacity, and a full queue is reported explicitly.

Personal comparisons and statistical deviations require at least fourteen recorded baseline days. Insights describe interaction only, with no productivity or medical judgments. Optional process context, acceleration/entropy/variability analytics and more detailed per-monitor distance attribution remain future-phase features, as distinguished from MVP features in the PRD.

## Release acceptance

See [docs/validation.md](docs/validation.md) for checks performed in this workspace and the remaining Windows release gates. Compile success and synthetic throughput do not establish global capture accuracy, the CPU/RAM budgets, startup behavior, installer behavior, or 24–72-hour reliability on real hardware.

On a Windows machine that permits execution, use `scripts/measure-collector.ps1 -DurationSeconds 60` to record CPU and memory of an already-running collector. It never starts tracking or changes your preferences. Repeat during idle, normal use, and high polling-rate input; longer durations can cover the required stability window.
