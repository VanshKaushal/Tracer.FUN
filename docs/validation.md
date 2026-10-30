# Validation and release gates

## Free Windows beta — October 30, 2026

Published the free download page at https://trace-free-desktop.deekaushal16.chatgpt.site/ and the `v0.1.0-beta.1` GitHub prerelease. The Windows setup is hosted directly with the website, with GitHub Releases as a mirror. Anonymous HTTP checks confirmed the page and installer return 200, and an unknown URL returns the branded recovery page with HTTP 404. A browser click saved `Trace-Windows-x64-Setup.exe`; its SHA-256 matched the clean Windows build artifact.

- Clean Windows build: [run 41092322986](https://github.com/VanshKaushal/Tracer.FUN/actions/runs/41092322986) passed 19 frontend tests, 2 bridge tests, 15 browser tests, 20 Rust tests and the native MSVC release/NSIS build. Setup is 5,059,300 bytes; SHA-256 is `1f8413ce9e78b4ae6b795c93e3447efdddb10eefee93fb35c099612538df08f8`.
- Installer lifecycle: [run 41098118856](https://github.com/VanshKaushal/Tracer.FUN/actions/runs/41098118856) downloaded the public setup, checked the pinned checksum, installed it, verified both native window titles in the host process and automatic collector startup, checked opt-in defaults, created a focus-history record, upgraded with both processes running, uninstalled, reinstalled and verified retained preferences/history. The final uninstall also ran with both processes open, and both executable files were removed. This is disposable Windows-runner evidence, not physical Windows 10/11 certification.
- The first-run flow passed a separate keyboard/focus and tracking-consent check at 320 × 420 pixels. Dialogs now scroll within short windows. The first-run copy states the app is free, explains local storage and clarifies background collection. Application Control and missing-file messages provide end-user recovery guidance.
- The download page was checked at 320/430/768/1440 px, with no document overflow or broken internal anchors. Its menu, assets, recovery link and one-click setup download passed. Screenshots were inspected. The illustration explicitly labels sample data; no reviews or usage numbers were invented. Production npm audit reported zero vulnerabilities.
- Tauri's build/dev hooks now explicitly use the repository root; the previous working directory could make npm look for a missing `apps/desktop/package.json`. NSIS embeds the WebView2 bootstrapper, installs for the current user and retains history. Its empty-metric bottom hover view has a minimum width for status and controls.

The installer is **NotSigned**. Trusted signing, Windows 10/11 clean-account tests without WebView2, real hardware/DPI/fullscreen/suspend checks and sustained performance measurements remain general-availability gates. The public download clearly identifies the release as an unsigned Windows x64 beta. No payment system, account requirement or activity telemetry was added. `main` remains unmerged.

## Dashboard checklist fixes — October 12, 2026

Added a labelled mobile navigation drawer with focus containment, Escape/backdrop closing, automatic close on navigation or desktop resizing, and current-page link semantics. Added route-specific document titles, a shared SVG browser favicon and descriptions for both HTML entries. Unknown hash routes and unknown direct paths render a client-side recovery page instead of silently showing Overview. The privacy footer remains text-only; no unused contact or copyright elements were introduced.

Populated-data checks exposed horizontal overflow from long monitor names in Heatmap filters. Monitor selectors are now constrained to their available width and filter buttons wrap. Small screens use the full page width, large values wrap, and table scrolling is contained inside panels. The sidebar scrolls on short screens so its remaining navigation entries stay accessible.

Production TypeScript/Vite build, 19 unit tests, 2 bridge tests and 15 Playwright checks passed. New regressions cover keyboard focus, mobile navigation and resize recovery, route titles, unknown-page recovery, favicon/description presence, and populated views across all ten routes at 320, 430 and 768 pixels. Mobile screenshots were inspected. The latest dashboard is served at the local development URL for review against the existing collector.

The native executable refresh could not complete: the earlier build container is no longer available, and Windows Application Control blocked a native build helper in temporary storage (OS error 4551). Temporary build output was cleaned, Docker was returned to its previous stopped state, and the working portable desktop and native collector were preserved. Source and frontend build contain the new UI; the portable desktop executable still contains the previous frontend until a trusted packaging build is available.

## Native collector launch repair — October 12, 2026

The portable cross-built collector was rejected by Windows Application Control while the dashboard and bar could run. Built the same source using the native Windows MSVC toolchain (`cargo build --offline -p trace-agent`, with incremental compilation disabled) and replaced `dist/Trace-Bar/trace-agent.exe` with the resulting development executable. Updated the portable SHA256 manifest. No signing certificate was available and no Windows security settings were changed.

The first build failed because E: was full. Removed only the untracked generated `target/debug/incremental` cache (about 548 MiB), then rebuilt successfully. Source files and the existing tracking database were preserved.

Verified the packaged native collector starts successfully, reports tracking enabled with no storage error, and supplies real increasing distance and click totals to the dashboard and Trace Bar. The dashboard showed Tracking on and the bar displayed an active session timer. A clean stop/restart preserved recorded data, and launching `trace.exe --show-all` automatically started the packaged collector; only one collector and one window host remained. Both views were left running. The prior collector execution block is resolved locally for this development build; release signing and long-duration performance checks remain pending.

## Trace Bar hover refinement — October 5, 2026

Added backward-compatible hover preferences for timer, clicks, cursor distance, scroll steps and active time. Hover reveals immediately and remains visible under the pointer; leaving collapses after 120 ms when auto-collapse is enabled. Left/right layouts now show the same selectable details as bottom, with adaptive window dimensions and larger values. The clicked expanded view retains its metrics and controls.

Production TypeScript/Vite build, 19 frontend unit tests, 12 Playwright checks, the Windows GNU collector/desktop release build and strict Clippy passed. Three new UI checks verify all five details fit inside left/right/bottom hover bounds and collapse on pointer leave; screenshots were inspected. The updated collector runs successfully with the user's saved tracking consent, docking and distance preferences.

The updated desktop executable was blocked at launch by Windows Application Control (Code Integrity event 3077, OS error 4551). A native Windows build was also blocked while executing libc's build helper. Consequently, the updated native hover view has not been verified on the desktop and the new dashboard is not running. No Windows security settings were changed. The build in `dist/Trace-Bar` requires trust/signing acceptable to this machine's policy before native validation can continue.

## Trace dashboard and bar launch repair — October 5, 2026

Fixed a live Windows deadlock when a bar-first instance receives a dashboard reopen request: WebView creation ran inside the single-instance WM_COPYDATA callback. That callback now dispatches work to a separate thread, and window-creating commands use async execution. A creation mutex prevents simultaneous live updates and reopen requests from creating duplicate window labels. Added `start-trace.cmd` and `--show-all` to open both views with one collector.

The updated Windows GNU release build and strict desktop Clippy passed. Verified the actual native windows: bar-first startup followed by dashboard launch, repeated launches exiting successfully, closing the dashboard while the bar remains, reopening the dashboard from the bar, closing the bar while the dashboard remains, and reopening the bar from the dashboard. Pausing from the bar changed the dashboard to Paused; resuming from the dashboard changed the bar to Tracking. Both showed matching distance totals. The existing collector stayed running throughout. Auto-collapse was temporarily disabled for UI inspection and its original setting restored afterward. This verifies local launch and shared-control behavior; the hardware and long-duration gates below remain pending.

## Trace Bar integration — October 3, 2026

The current `prd.md` Trace Bar addendum is implemented in the collector, secure IPC, native window host, separate frontend entry point, dashboard Focus page, settings, database migration, and documentation. See [Trace Bar specification](TRACE_BAR_SPEC.md) and [test plan](TEST_PLAN.md).

- Production TypeScript/Vite build passed. The overlay entry contains roughly 10 KB of bar-specific JavaScript plus shared React/IPC utilities; its dependency graph excludes the approximately 600 KB ECharts chunk.
- 19 frontend unit tests, 9 Playwright regressions, and 2 development-bridge tests passed. The new UI regressions cover shared tracking controls, privacy, focus completion, keyboard/Escape behavior, saved unit preference versus an older live snapshot, and bar settings. Expanded-bar screenshots were inspected.
- 23 portable Rust tests passed in the prepared Linux container with `TZ=Asia/Kolkata`, including docking in negative-coordinate work areas, old-setting defaults, privacy/focus boundaries, focus crash recovery, idempotent persistence, range deletion, and prior-day record thresholds. Earlier native Windows test runs also passed; the final host test executable was blocked by Windows Application Control, so the final portable suite used the container.
- Strict host collector/core/metrics/storage/IPC Clippy passed. The desktop and collector also passed strict Windows GNU target checks. The native release cross-build passed using the existing Rust/MinGW container.
- The final cross-built Windows collector passed `smoke-trace-bar.mjs` under a normal Windows process token. It used a distinct SID-scoped pipe/mutex name and isolated database, checked actual hook movement, live event delivery, pause/resume, focus, incognito ignoring movement, settings propagation, restart persistence, client-disconnect independence, and deletion. The existing user collector and its database were left running and untouched.
- The updated unsigned portable preview is delivered separately in `dist/Trace-Bar`. The previously running portable app and root installer are preserved; switching requires stopping the old collector and closing the old dashboard.

Native window behavior across physical monitors, taskbar/DPI changes, fullscreen games/video, installer lifecycle, and the 8-/24-hour performance budgets remain manual hardware release gates. The implementation and passing automated checks do not establish production acceptance for those gates.

Local repair verification on October 3, 2026:

- Native Windows Rust tests: 16 passed (10 metrics, 6 storage), plus 6 frontend tests, 2 named-pipe bridge tests and 5 Playwright regressions, including collector startup recovery and saved tracking consent. TypeScript and the production frontend build passed.
- `node scripts/smoke-windows.mjs --browser` passed with an isolated database: Win32 pointer movement through the global hook, stored distance, heatmap and sessions; settings, pause/resume, JSON/CSV exports, restart persistence and date deletion. The real browser connection also passed settings toggles, pause/resume, export download and all analytics routes. Requests without bridge authorization returned 403. The overview screenshot was inspected at 1440 pixels.
- Found the existing collector's worker had stopped while its IPC thread remained alive. Its maintenance timers subtracted 24 hours from `Instant::now()` on a machine with approximately 3.5 hours of uptime. Maintenance now uses an initially absent timestamp, avoiding that startup panic. Worker panics are logged and close the collector; a disconnected worker has a distinct IPC error.
- Desktop startup now waits for collector readiness and surfaces missing executables, launch failures and early exits. Settings retry on later dashboard refreshes, and the dashboard refreshes every three seconds. The Windows development browser connects through a token-protected loopback bridge; static production builds contain no bridge token or endpoint.
- Refreshed the portable Windows executables, WebView2 loader, NSIS installer and SHA256SUMS. Launching the final desktop executable started a healthy collector on the existing user database: no storage error or queue overflow, with the original first-run tracking consent still disabled. The local browser server was then started for user testing.
- Saving unrelated preferences no longer changes Windows startup registration. The isolated smoke test leaves real user data and startup preferences untouched. Deletion is tested while paused to prevent newly tracked time from recreating the selected day.

Windows Application Control still blocks some native **release-build helper executables** (OS error 4551), so release builds use the prepared Linux/MinGW container. Native debug tests and the cross-built collector execute successfully on this host. Installer lifecycle and long-duration release acceptance still require the checks below.

## Earlier baseline checks

Completed source checks on October 3, 2026:

| Check                                                          | Observed result                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Rust tests in Linux with `TZ=Asia/Kolkata`                     | 16 passed: 10 metrics tests and 6 storage/integration tests                                                                   |
| Strict Windows-target collector/storage/IPC and desktop Clippy | Passed with `-D warnings`                                                                                                     |
| React/TypeScript production build                              | Passed; the ECharts chunk is approximately 600 KB before compression and triggers Vite's size advisory                        |
| Frontend metric tests                                          | 6 passed                                                                                                                      |
| Playwright browser tests                                       | 4 passed, including a mocked Tauri transport test for out-of-order range results and pause/resume                             |
| npm dependency audit                                           | Zero reported vulnerabilities                                                                                                 |
| Synthetic million-event computation run                        | Approximately 0.39 seconds in the container                                                                                   |
| Simulated 72-hour continuous session                           | Passed daily totals, session continuity, exact distance and bounded-buffer assertions; simulated time, not a real 72-hour run |
| Windows binary execution on host                               | Previously blocked; superseded by the successful live Windows smoke check above                                                |

The final x86_64 Windows GNU release build and NSIS packaging completed successfully. `dist` contains `trace.exe`, `trace-agent.exe`, `WebView2Loader.dll`, and the approximately 3.18 MB `Trace-0.1.0-setup.exe`. The installer compiled without NSIS warnings. These are unsigned development artifacts; install/launch behavior has not been validated on this host.

The preview regression uses empty data and the Tauri transport regression uses a test-only mock. The additional Windows smoke check above exercises real collection and the browser bridge.

## Automated coverage

- Geometry, circular direction differences, negative monitor coordinates and normalized heatmap bounds.
- High-rate distance accumulation with sampled speed updates; click pairs, completed drags, native scrolling and wheel bursts.
- Active/idle transitions, session restart, movement anchor resets after sleep/clock jumps, queued timestamps and monitor changes.
- Calendar-minute splitting and cross-midnight active sessions in Asia/Kolkata.
- WAL persistence/reopen, unfinished-session recovery, CSV exports, raw/minute retention while hourly data remains.
- Transaction rollback, temporary SQLite locking and pending-batch retry.
- Date-range deletion preserving outside-day session fragments and removing matching heatmap cells.
- Distance across adjacent known monitors, display reconfiguration, and a simulated three-day active session.
- UI metric semantics, estimates, weighted speed aggregation, calendar range rollover and baseline eligibility.
- Browser navigation through all nine routes, preview privacy/disabled export, custom dates, click filters and compact settings layout.
- A synthetic one-million-event metrics run. This benchmark measures computation throughput, not operating-system hook overhead or steady-state CPU.

## Windows acceptance still required

1. Install on Windows 10/11 with and without WebView2 already present; verify uninstall and upgrade with the collector running.
2. Grant tracking consent; verify known counts for rapid left/right/middle clicks, double clicks, drags and both wheel axes using real devices.
3. Enable startup, log out/in, and verify the collector starts without a dashboard. Close the dashboard and verify data continues accumulating.
4. Test all pause durations, resume, settings, CSV/JSON export, selected-range and all-data deletion.
5. Suspend overnight, resume, lock/unlock, move between negative-coordinate monitors, disconnect displays, change DPI/resolution, and adjust the system clock.
6. Measure collector working set (<30 MB), idle CPU (<0.2%), normal CPU (<1%), and overload CPU/backlog at 1,000 events/s. Measure today-query latency (<1 second).
7. Run for 24–72 hours across midnight while observing memory, CPU, disk growth, sessions, retention, hook availability and restart after abrupt termination.

These are release gates, not claimed passing results. Live tracking was enabled temporarily only in isolated smoke-test databases; real-user tracking consent and startup settings were preserved. The cross-build's dashboard DLL imports include `WebView2Loader.dll`; the portable folder and fallback installer bundle the x64 loader supplied by the WebView2 dependency. The full WebView2 Runtime must already be installed for that fallback installer.
