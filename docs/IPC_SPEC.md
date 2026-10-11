# Trace Bar IPC

Both named pipes are scoped to the current Windows user SID, use a current-user-only ACL, reject remote clients, and carry bounded, length-prefixed JSON frames. No listener or WebSocket is added for the overlay.

- Commands: `\\.\pipe\Trace-<SID>`. Existing request/reply framing and acknowledgements remain compatible.
- Events: `\\.\pipe\Trace-<SID>-Live`. A subscriber reads successive `LiveStats` JSON frames. There are at most eight concurrent subscribers, each with a bounded write timeout. A single latest snapshot replaces prior snapshots in memory.

New commands: `GetLiveStats`, `GetBarSettings`, `SetBarSettings {settings}`, `SetIncognito {enabled}`, `StartFocus`, `EndFocus`, and `GetFocusSessions {range}`. Existing Pause/Resume/SaveSettings/Delete/Export commands are shared with the dashboard. `GetLiveStats` reads in-memory state and does not flush or query SQLite.

Snapshots contain timestamp, tracking/pause/incognito/suspend state, the current session, today's aggregate stats, active/completed focus, saved settings, conversion DPI, the current insight, and storage errors. They contain no raw pointer-event stream or absolute pointer coordinates. The desktop host forwards snapshots as the `trace-live` event to its WebViews and reports disconnects with `trace-unavailable`.

The desktop reconnects after 1, 2, 5, 10, then 30 seconds. It does not automatically restart a stopped collector on every reconnect; the user can choose Restart Trace. Startup and an explicit restart use the existing collector readiness checks.

For isolated tests only, `TRACE_INSTANCE` adds a validated alphanumeric/hyphen suffix to the pipe and mutex names. `LOCALAPPDATA` selects the isolated database directory. The regular user instance is unaffected.
