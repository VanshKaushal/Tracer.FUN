Trace is free to use, with no account, subscription, trial or payment details.

Get the one-click download and installation guide at https://trace-free-desktop.deekaushal16.chatgpt.site/. The website hosts the same checksum-verified setup file as this release.

Download **Trace-Windows-x64-Setup.exe**, open it and follow the setup screens. Open Trace from the finish screen or Start menu. No terminal, Node.js or Rust is needed. Setup installs for your Windows account and offers to install Microsoft's WebView2 runtime if needed (internet required).

This beta supports Windows 10/11 on Intel/AMD 64-bit PCs. Native macOS, Linux, ARM64 and mobile tracking are not included.

The dashboard and Trace Bar share one collector. Tracking starts only after you enable it. History stays on your PC in `%LOCALAPPDATA%\Trace`; no activity data is uploaded. Closing the dashboard keeps the collector running. Pause or quit from the system tray. Use Settings to export or delete history. Installing an update preserves history.

This beta installer is unsigned. Windows may warn about an unknown publisher, and devices using Application Control may block it. Do not disable device security to install it. A trusted publisher signature and clean-machine install/upgrade/uninstall verification are required before general availability.

Report problems at https://github.com/VanshKaushal/Tracer.FUN/issues. Avoid attaching your database or private activity exports to public issues.

The [Windows build](https://github.com/VanshKaushal/Tracer.FUN/actions/runs/41092322986) passed frontend, bridge, browser and Rust checks. The [installer lifecycle check](https://github.com/VanshKaushal/Tracer.FUN/actions/runs/41098118856) verified installation, both native windows, automatic collector startup, running upgrade, uninstall and history recovery on a disposable Windows runner. Physical Windows 10/11 and long-duration checks remain pending.
