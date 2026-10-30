# Trace

Trace is a Windows desktop app for understanding how you use your mouse or trackpad. It records cursor movement, clicks, scrolling and activity sessions locally, then presents them in a dashboard and a compact desktop bar.

The dashboard and Trace Bar work alongside one collector. They share tracking state and data, so input is recorded once.

**Trace is free.** No account, subscription, payment details or trial period is required.

## Download and install

Use the [Trace download page](https://trace-free-desktop.deekaushal16.chatgpt.site/) or [Windows beta release](https://github.com/VanshKaushal/Tracer.FUN/releases/tag/v0.1.0-beta.1).

1. Download **Trace-Windows-x64-Setup.exe** and double-click it.
2. Follow setup, then open Trace from the finish screen or Start menu.
3. Choose whether to enable tracking. Open **Trace Bar** from the dashboard header and customize it in **Settings**.

No terminal or developer tools are needed. Setup installs for your Windows account and handles WebView2 if missing; that runtime step needs internet. Updates preserve local history.

The initial beta supports Windows 10/11 on Intel/AMD 64-bit PCs. It is unsigned: Windows may warn about an unknown publisher, and Application Control can block it. Do not disable device security. Trusted signing and the remaining clean-machine checks are required before general availability.

## Features

- **Interaction dashboard:** activity trends, movement and click statistics, heatmaps, sessions, history and insights.
- **Selectable distance units:** pixels, millimeters, centimeters, meters, kilometers, inches, feet, yards and miles. Your preference applies to the dashboard and Trace Bar.
- **Trace Bar:** a separate always-on-top window that docks to the left, right or bottom of your screen.
- **Configurable hover details:** choose session timer, clicks, cursor distance, scroll steps and active time independently of the expanded view.
- **Focus sessions:** start and end manual sessions, inspect their statistics and review saved history.
- **Tracking controls:** pause, resume and incognito from the dashboard or bar.
- **Local exports:** export JSON or CSV and delete selected date ranges or all recorded data.
- **Responsive dashboard:** a labelled mobile navigation drawer with keyboard focus handling, route-specific browser titles, a favicon and an unknown-page recovery view. Long monitor names and populated analytics stay within their panels on narrow screens.

## Platform support

| Environment | Current support |
| --- | --- |
| Windows 10/11 desktop | Collector, dashboard and native Trace Bar implemented; hardware release checks remain pending. |
| Local Windows browser | Development dashboard connected to the Windows collector. |
| macOS and Linux | Dashboard preview only. Native collectors and Trace Bar support are not implemented. |
| Android, iPhone and iPad | No native implementation or system-wide tracking support. |

A browser preview does not collect global input. Cross-platform tracking needs separate collectors, permissions, local communication and window integration for each operating system. Remote viewing and cloud synchronization are not implemented.

## For developers: run from source

### Requirements

- Windows 10 or 11.
- Node.js 22 or newer and npm.
- Rust stable with the Windows MSVC toolchain.
- Visual Studio C++ Build Tools and the Windows SDK.
- Microsoft Edge WebView2 Runtime.

From the project folder, run these commands in Command Prompt or PowerShell:

```text
npm ci
npm run desktop
```

This builds the collector sidecar and starts the Tauri app with the Vite development server. On first launch, enable interaction tracking on the welcome screen to start recording. Tracking and launch-at-login are disabled by default.

### Use an existing portable build

Portable executables are generated locally and are excluded from Git. If you already have the updated build in `dist/Trace-Bar`, keep these files together:

```text
dist/Trace-Bar/
  trace.exe
  trace-agent.exe
  WebView2Loader.dll
```

Open the dashboard and Trace Bar together from the project folder:

**Command Prompt**

```cmd
start-trace.cmd
```

**PowerShell**

```powershell
.\start-trace.cmd
```

The launcher runs `dist\Trace-Bar\trace.exe --show-all`. Repeating it reopens the existing views. Additional launch options are:

| Command | Behavior |
| --- | --- |
| `trace.exe` | Open the dashboard; bar visibility follows saved preferences. |
| `trace.exe --show-all` | Open the dashboard and request the expanded bar. |
| `trace.exe --show-bar` | Open or expand the bar. |
| `trace.exe --bar-only` | Start the bar without opening the dashboard. |
| `trace.exe --settings` | Open dashboard settings. |

When switching from an older build, use its tray action **Stop Trace completely**, close its dashboard, then launch the updated build. Older root-level executables and installers may not include the latest changes.

## Using Trace Bar

Open it from the dashboard's **Trace Bar** button, **Settings > Trace Bar > Open Trace Bar**, or the collector tray's **Show Trace Bar** action.

- Hover reveals the selected details immediately. With auto-collapse enabled, leaving the hover view tucks it away after 120 milliseconds.
- Choose hover content in **Settings > Trace Bar > Hover details**, then click **Save preferences**.
- Left and right docks use a two-column layout; bottom docking uses a horizontal row. Window dimensions follow the selected details.
- Click the bar to open the full view with statistics and controls.
- Drag it between displays or near an edge to dock it. Its monitor-relative position is saved.
- Use Tab and Enter for keyboard navigation. Escape collapses the bar.
- Fullscreen hiding, automatic launch, notifications and focus controls are configurable. No global shortcut is registered automatically.

Closing either view leaves the other view and collector running. Pause and incognito affect collection globally and are reflected in both views. Incognito ignores new input and ends the current focus session. To stop collection and exit the collector, use **Stop Trace completely** in the tray.

## Local browser development

```text
npm run dev
```

Open [http://127.0.0.1:1420](http://127.0.0.1:1420). On Windows, a loopback-only development bridge connects the dashboard to the collector. It starts an available collector from the portable or debug build, and uses the same local database as the desktop app. The dashboard refreshes analytics every three seconds; live state updates use a separate channel.

To view the UI without connecting to a collector:

**Command Prompt**

```cmd
set TRACE_BROWSER_PREVIEW=1
npm run dev
```

**PowerShell**

```powershell
$env:TRACE_BROWSER_PREVIEW = "1"
npm run dev
```

The preview flag applies to that terminal session. Static production previews and non-Windows browsers do not provide global tracking. Publishing the frontend alone does not turn it into a device-wide collector.

## Privacy and data

Trace stores data in `%LOCALAPPDATA%\Trace\trace.db` using SQLite. The collector captures pointer events; it does not collect keyboard input, screen images, clipboard contents, URLs, window titles or document contents. Application tracking is not implemented. The packaged app has no network listener or remote analytics service.

Local browser development uses an origin-checked, token-protected loopback bridge. Desktop communication uses current-user SID-scoped named pipes with user-only access and remote clients rejected.

Raw click and drag records have configurable retention of 1-24 hours. Minute aggregates expire after 7-30 days. Hourly and daily aggregates, sessions and heatmaps remain until deleted. Cleanup runs while the collector is active. Schema version 2 adds focus history and migrates version-1 databases transactionally.

Distance is stored canonically in pixels. Physical units estimate cursor travel across the screen using display DPI; they do not measure mouse movement on your desk. A 96 DPI fallback is used when a single display DPI is unavailable. Scroll steps represent absolute native wheel delta divided by 120. Speed percentiles use approximate histogram values. Baseline comparisons require at least fourteen recorded days.

## Build and validation

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check and build the dashboard and bar frontend. |
| `npm test` | Run frontend unit tests. |
| `npm run test:bridge` | Check the local development bridge. |
| `npm run test:ui` | Run Playwright UI regressions. |
| `cargo test` | Run Rust workspace tests on a configured Windows toolchain. |
| `npm run status` | Inspect the running collector and saved settings. |
| `npm run test:windows` | Exercise Windows capture, persistence and controls using an isolated data directory. |
| `npm run test:bar` | Exercise live IPC, focus, incognito and bar settings using an isolated collector instance. |
| `npm run installer` | Build the current-user Windows installer. |

Install the Playwright browser before the first UI test run:

```text
npx playwright install chromium
npm run test:ui
```

Windows smoke tests require the matching collector executable. They briefly move the cursor and restore it. Read [the test plan](docs/TEST_PLAN.md) before running native checks. The older Windows smoke test requires no existing collector; the Trace Bar smoke test uses a separate instance and database. Add `--browser` to `node scripts/smoke-windows.mjs` to check the connected browser flow.

The normal installer bundles the collector and supports WebView2 installation. [The container build script](scripts/build-windows-container.sh) provides a Rust/MinGW fallback and NSIS packaging. Build the frontend before using that script; its documented container prerequisites must be installed. The fallback requires an existing WebView2 Runtime and produces unsigned executables.

## Architecture

| Component | Responsibility |
| --- | --- |
| `crates/trace-core` | Event types, settings, statistics contracts and docking geometry. |
| `crates/trace-metrics` | Movement, clicks, scrolling, activity, focus sessions and insights. |
| `crates/trace-storage` | SQLite migrations, persistence, retention, history and exports. |
| `crates/trace-ipc` | Secure commands and bounded live-statistics delivery. |
| `crates/trace-agent` | Windows input capture, collector worker, tray and system lifecycle. |
| `apps/desktop` | Tauri window host, React dashboard and separate Trace Bar frontend. |
| `migrations` | Versioned database schema changes. |
| `scripts` | Development, packaging and native validation helpers. |

The collector publishes live totals from memory. Trace Bar does not poll SQLite and does not load the dashboard's chart bundle. Closing a view does not terminate collection. Pending storage batches are retained for retry; prolonged storage failure pauses collection and is reported to the UI.

## Troubleshooting and release status

**No recorded activity:** confirm tracking is enabled and neither pause nor incognito is active. Run `npm run status` to inspect the collector.

**Trace Bar is missing:** confirm it is enabled in Settings, check the saved dock edge, or launch with `--show-all`. Its collapsed form is a small edge tab. Fullscreen applications can hide it according to preferences.

**Collector is unavailable:** keep the executables together, inspect `%LOCALAPPDATA%\Trace\trace.log`, and use the dashboard's reconnect control.

**Windows blocks execution:** unsigned builds can be rejected by Application Control. The cross-built collector was rejected on the development machine. Rebuilding the same collector with the native Windows MSVC toolchain and replacing the portable collector restored tracking; a clean dashboard launch then started it automatically. That local repair uses a development build, and does not establish acceptance on other machines. Distribution requires a build trusted by the target machine's policy; successful compilation alone does not establish that an executable can run there.

This is an implementation preview, not a production-certified release. Multi-monitor and DPI behavior, fullscreen applications, installer lifecycle and long-duration CPU/memory checks still need hardware validation. See [validation results and remaining gates](docs/validation.md) for the distinction between passing checks and unverified native behavior.

## Project documentation

- [Product requirements](prd.md)
- [Technical requirements](trd.md)
- [Trace Bar specification](docs/TRACE_BAR_SPEC.md)
- [IPC protocol](docs/IPC_SPEC.md)
- [Data model](docs/DATA_MODEL.md)
- [Test plan](docs/TEST_PLAN.md)
- [Validation results](docs/validation.md)
- [Free launch checklist](docs/FREE_LAUNCH.md)
- [Release notes](docs/RELEASE_NOTES.md)
