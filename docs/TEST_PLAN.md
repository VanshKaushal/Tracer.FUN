# Trace Bar checks

Automated commands:

```powershell
npm test
npm run build
npm run test:ui
npm run test:bridge
cargo test -p trace-core -p trace-metrics -p trace-storage -p trace-ipc
cargo clippy -p trace-agent -p trace-core -p trace-metrics -p trace-storage -p trace-ipc --all-targets -- -D warnings
cargo build -p trace-agent
npm run test:bar
```

`test:bar` uses a distinct instance name and workspace database, temporarily moves the pointer and restores it, and checks actual Windows hook activity, live push delivery, pause/resume, focus, incognito exclusion, subscriber disconnect, saved settings, restart persistence, and deletion. It stops its own collector. A restricted Windows token may prevent synthetic input from reaching the hook; use a normal desktop terminal for that hardware check.

Browser tests cover all existing dashboard regressions plus the bar's controls, tracking-state synchronization through a mocked native transport, distance units, focus completion, Escape, keyboard accessibility, and docking settings. The test launcher owns and cleans up its preview server directly, avoiding Windows shell-process shutdown hangs.

Hardware release checklist:

1. Start the portable Windows app; verify the bar appears and is above ordinary windows, absent from the taskbar, and independent of the dashboard.
2. Drag to left/right/bottom edges and between monitors with different DPI; confirm the snap threshold, offset persistence, and no accidental button activation during dragging.
3. Change resolution, scaling, and taskbar placement; disconnect/reconnect displays and test laptop docking. Confirm a removed monitor falls back to the primary working area.
4. Confirm hover does not take focus from another app; clicking Expanded enables Tab/Enter; Escape collapses. Confirm 5-second/3-second collapse and Compact persistence during focus.
5. Check fullscreen games, video, presentations, and the opt-in overrides. Verify the bar reappears afterward.
6. Close each UI separately, disable the bar completely, reopen from the tray, and confirm the collector continues. Stop/crash the collector and verify a persistent unavailable state, reconnect backoff, and explicit restart.
7. Exercise sleep/resume, lock/unlock, midnight, manual focus, privacy boundaries, and all pause durations with physical input devices.
8. Measure collector RAM (<30 MB target) and CPU at idle, normal input, and 1,000 events/sec. Run 8-hour idle and 24-hour mixed-use checks. Browser compilation and synthetic engine tests do not establish these budgets.
9. Test Windows 10/11 installer upgrade/uninstall and startup with tracking consent preserved.
