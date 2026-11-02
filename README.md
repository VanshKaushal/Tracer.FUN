# Trace

Free, local mouse and trackpad activity analytics for Windows.

[Download for Windows](https://gettrace.pages.dev/) · [Release notes](https://github.com/VanshKaushal/Tracer.FUN/releases/tag/v0.1.0-beta.1) · [Report an issue](https://github.com/VanshKaushal/Tracer.FUN/issues)

Trace turns cursor movement, clicks, scrolling and activity sessions into a personal dashboard. A compact desktop companion, Trace Bar, keeps selected statistics close while you work. Both views share one collector and one local history.

No account, subscription or payment details are required. Activity stays on your PC.

## Install

1. Open the [download page](https://gettrace.pages.dev/) and download **Trace-Windows-x64-Setup.exe**.
2. Double-click setup and follow the installation screens.
3. Open **Trace** from the finish screen or Start menu, then choose whether to enable tracking.
4. Select **Trace Bar** in the dashboard header to open the bar. Customize its position and hover details in **Settings**.

Users do not need Command Prompt, Node.js, Rust or Git. Setup installs for the current Windows account and handles a missing WebView2 Runtime; that step requires internet.

**Beta status:** the current installer is unsigned. Windows may show an unknown publisher warning, and Application Control can block it. Do not disable device security. Trusted signing and physical-device acceptance checks remain before general availability. See [validation status](docs/validation.md).

## What Trace provides

- **Activity dashboard:** movement, clicks, scrolling, sessions, heatmaps, history and insights.
- **Distance units:** pixels, millimeters, centimeters, meters, kilometers, inches, feet, yards and miles, shared across the dashboard and bar.
- **Desktop bar:** left, right or bottom docking, configurable hover details and an expanded view with controls.
- **Focus sessions:** start a session, review its interaction statistics and retain its history.
- **Collection controls:** pause, resume and incognito from either view.
- **Data control:** export JSON or CSV, delete a date range or remove recorded activity.

Physical distance units estimate cursor travel across the screen using display DPI. They do not measure how far a mouse moves on a desk.

## Platform support

| Platform                        | Status                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Windows 10/11, Intel or AMD x64 | Native collector, dashboard and Trace Bar; public beta.                      |
| macOS, Linux and Windows ARM64  | Native releases are not available.                                           |
| Android, iOS and iPadOS         | System-wide tracking is not available.                                       |
| Browser                         | Responsive UI preview; Windows development can connect to a local collector. |

The website is the download and installation guide. Global input collection runs in the installed Windows application.

## Privacy and local history

- Tracking and starting with Windows are opt-in.
- Trace records pointer activity. It does not record typed text, screenshots, clipboard contents, browsing URLs or document contents.
- History is stored in `%LOCALAPPDATA%\Trace\trace.db` using SQLite. There are no accounts, activity uploads or cloud synchronization.
- The database is not encrypted by Trace. Protect your Windows account and device.
- Raw click/drag records default to 24 hours of retention; minute aggregates default to 30 days. Higher-level aggregates, sessions and heatmaps remain until deleted.
- Updates and uninstall preserve local history. Use **Settings** to export or delete recorded activity before uninstalling if desired.

Closing a view keeps the collector running when tracking is enabled. Use the system tray to pause or stop collection. Pause and incognito are shared by both views.

## Develop

The native app requires Windows, Node.js 22+, Rust stable with MSVC, Visual Studio C++ Build Tools, the Windows SDK and WebView2.

```text
npm ci
npm run desktop
```

This builds the collector sidecar and starts the Tauri application. For browser preview, testing, architecture and troubleshooting, read the [development guide](docs/DEVELOPMENT.md).

```text
npm run build
npm test
npm run test:bridge
npm run test:ui
cargo test --workspace --exclude trace-desktop --locked
```

Install the Playwright browser with `npx playwright install chromium` before the first UI test run. Native smoke checks have additional requirements described in the [test plan](docs/TEST_PLAN.md).

## Repository structure

| Path            | Contents                                                      |
| --------------- | ------------------------------------------------------------- |
| `apps/desktop/` | Tauri host, React dashboard and Trace Bar.                    |
| `crates/`       | Rust collector, shared types, metrics, IPC and storage.       |
| `migrations/`   | Versioned SQLite schema.                                      |
| `tests/`        | Browser regression tests.                                     |
| `scripts/`      | Development, packaging and verification tools.                |
| `website/`      | Cloudflare Pages download website.                            |
| `docs/`         | Development, release, architecture and validation references. |

Generated schemas, dependencies, databases, caches and built installers are excluded from source control. Public installers are distributed through the website and GitHub Releases.

## Documentation and contributions

Start with the [documentation index](docs/README.md). See [release and hosting instructions](docs/RELEASING.md) for Windows packaging and Cloudflare Pages deployment.

Bug reports should include the Trace version, Windows version, reproduction steps and expected behavior. Do not attach your activity database or private exports to a public issue. For code changes, follow the development guide and include relevant validation.

## License

[MIT](LICENSE)
