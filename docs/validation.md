# Validation status

Trace is an unsigned Windows x64 beta. Automated checks demonstrate the behavior listed below; they do not establish trusted publisher signing or full physical-device acceptance.

## Recorded release checks

| Check                                                     | Evidence                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Native MSVC build and NSIS package                        | [Windows build](https://github.com/VanshKaushal/Tracer.FUN/actions/runs/41092322986), including frontend, bridge, browser and Rust tests. |
| Public setup, both windows, collector startup and consent | [Installer lifecycle](https://github.com/VanshKaushal/Tracer.FUN/actions/runs/41098118856) on a disposable Windows runner.                |
| Running upgrade, uninstall and history recovery           | The same installer lifecycle run verifies retained preferences and focus history, and removal of both executables.                        |
| Cloudflare-hosted public installer                        | [Cloudflare installer check](https://github.com/VanshKaushal/Tracer.FUN/actions/runs/41520117325), with the pinned release checksum.      |
| Website delivery and mobile layout                        | Anonymous HTTP checks, branded HTTP 404, 320/1440 px browser checks and one-click download integrity verified on November 3, 2026.        |
| Populated dashboard and hover layouts                     | Browser coverage includes 320/430/768 px analytics routes and left/right/bottom hover details.                                            |

The released setup is `Trace-Windows-x64-Setup.exe`, 5,059,300 bytes, SHA-256:

```text
1f8413ce9e78b4ae6b795c93e3447efdddb10eefee93fb35c099612538df08f8
```

Run current source checks using the commands in [Development](DEVELOPMENT.md). Read the [test plan](TEST_PLAN.md) before native smoke checks, which can move the pointer and have collector-instance requirements. Historical numbers are recorded evidence, not claims that every prior check was rerun for a documentation-only change.

## Remaining general-availability checks

- Trusted Windows publisher signatures for the setup, dashboard host and collector.
- Physical Windows 10/11 installation, upgrade, uninstall and startup, including a machine without WebView2.
- Multiple monitors, negative coordinates, mixed DPI, display removal and taskbar changes.
- Fullscreen applications, focus behavior, sleep/resume, lock/unlock and cross-midnight collection.
- Measured CPU, memory, disk growth and sustained 8-/24-hour behavior with real input devices.

The [detailed test plan](TEST_PLAN.md) defines acceptance targets. Simulated event workloads and browser mocks do not replace hardware measurements. The [validation archive](archive/validation-history.md) preserves dated execution results, local runtime repairs and superseded build/hosting details.
