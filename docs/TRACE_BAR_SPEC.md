# Trace Bar implementation

The `prd.md` addendum is integrated with the existing Trace collector and dashboard. The bar is a separate Tauri window and Vite entry point (`trace-bar.html`), with no dashboard or ECharts imports. Its React view never captures global pointer input or reads SQLite.

## Windows and docking

The native window is transparent, frameless, non-resizable, always on top, and absent from the taskbar. Peek uses an actual 18 × 48 logical-pixel window; Compact uses 48 × 48 or 112 × 48 with a timer; Expanded and contextual cards use 280 × 350. Bottom Compact uses 380 × 76. Native sizes follow each monitor's scale factor and are clamped to its working area, keeping clear of the taskbar.

Drag the handle at the top of the expanded bar, or drag its compact control. Movement under six pixels activates the control; greater movement starts a native drag. Auto-collapse and automatic repositioning stop during drag. Left, right, and bottom edges snap within 48 logical pixels. A snapped position saves the monitor device name, edge, and relative offset; the primary monitor is the fallback when that device disappears. An unsnapped position remains transient. Monitor working areas are re-evaluated with each live frame, so changes to resolution, scaling, taskbar placement, and connected displays are handled without storing absolute desktop coordinates.

Hover expands Peek into Compact without requesting native focus. Clicking expands the interactive panel and allows keyboard focus. Tab/Enter operate controls and Escape collapses the panel. The dashboard header, settings panel, and collector tray can open the bar. No global keyboard shortcut is registered by default.

Expanded collapses after five seconds of inactivity; Compact tucks into Peek after three more. An active focus session keeps Compact visible. Contextual cards expire after eight seconds, or fifteen seconds for focus completion. The notification queue holds at most three cards, ordered by priority. Collector failures remain visible until recovery. Fullscreen detection runs with live frames, compares the foreground window to the bar's monitor bounds, excludes the desktop shell, and hides the bar by default. Focus and fullscreen-notification overrides are opt-in.

## Collector and shared state

The existing pointer engine owns daily in-memory totals, session state, focus aggregates, and incognito. A latest-value event channel publishes snapshots approximately once per second; user-requested changes publish immediately. Slow subscribers skip old snapshots. Closing the bar or dashboard does not send Stop to the collector. Disabling the bar closes its WebView.

The dashboard subscribes to the same native event stream, so pause, focus, incognito, and unit changes synchronize across windows. Historical dashboard queries retain their existing refresh cadence. The optional Windows development browser uses the existing authorized development bridge to request the in-memory snapshot; the packaged overlay uses only named pipes.

Distance and speed use the shared pixel conversion functions and saved unit preference. Physical units estimate screen travel using display scaling DPI; mixed displays use 96 DPI. They do not measure movement of the mouse on a desk.

## Focus and privacy

Focus starts only with tracking enabled and outside pause/incognito. Its counters start at zero and receive only subsequent tracked aggregates. Pause excludes activity from those counters. Incognito closes the current interaction and focus sessions, saves pending pre-incognito aggregates, and ignores subsequent input. Leaving incognito resets movement anchors and starts a new interaction session on the next event. No incognito events are replayed or stored.

Focus history is stored transactionally with telemetry, shown on the dashboard's Focus page, and included in JSON exports. Application-switch counts remain absent because application analytics is not enabled in this release. Recovery closes unfinished focus sessions at their last checkpoint, rather than inventing time after a crash. Date deletion removes overlapping focus sessions entirely; all-data deletion also clears them.

## Insights

The collector can surface continuous 90-minute sessions, daily click/distance records, longest sessions this month, unusual clicks relative to the same weekday, daily rollover summaries, and explicit focus completion. Unsolicited insights are limited to one per hour. Same-weekday comparisons need at least fourteen recorded days and two samples of that weekday; the baseline uses up to ninety recent days. Record thresholds use all prior daily history. History is loaded at startup and day rollover, not every second. No application names, screen captures, or personal content appear on the bar.

## Release verification

See `TEST_PLAN.md` and `validation.md`. Automated checks do not replace hardware tests for multi-monitor docking, fullscreen games/video, keyboard focus behavior, installer lifecycle, or long-duration resource budgets.
