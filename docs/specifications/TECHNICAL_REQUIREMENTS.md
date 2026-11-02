# Technical Requirements Document — Trace

**Version:** 1.0  
**Target OS:** Windows 10/11  
**Architecture:** Local-first desktop system  
**Primary Languages:** Rust + TypeScript  
**UI:** React  
**Desktop Shell:** Tauri  
**Storage:** SQLite  
**Distribution:** Windows installer

---

# 1. Technical Objectives

Trace must continuously collect high-frequency mouse/touchpad interaction telemetry while imposing negligible performance overhead.

Primary technical objectives:

1. Reliable global pointer capture.
2. Extremely low CPU usage.
3. Small memory footprint.
4. Efficient event aggregation.
5. Minimal disk writes.
6. Safe local persistence.
7. Independent dashboard lifecycle.
8. Accurate historical analytics.
9. Privacy-preserving architecture.
10. Graceful recovery after crash/reboot.

---

# 2. High-Level Architecture

```text
Windows Input Events
        │
        ▼
┌─────────────────────┐
│ Trace Collector     │
│ Rust                │
│                     │
│ Input Hook          │
│ Sampler             │
│ Session Engine      │
│ Metrics Engine      │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Aggregation Layer   │
│                     │
│ 1-sec buckets       │
│ minute buckets      │
│ heatmap buckets     │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ SQLite              │
│ WAL Mode            │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Tauri Application   │
│ React + TypeScript  │
│                     │
│ Dashboard           │
│ Charts              │
│ Settings            │
└─────────────────────┘
```

---

# 3. Process Architecture

Use two logical runtime components.

## Process A — Collector

Always running.

Responsibilities:

- OS input hooks
- cursor sampling
- aggregation
- session detection
- SQLite persistence
- startup handling
- system tray controls

Target:

RAM <30 MB

CPU <1%

---

## Process B — Dashboard

Runs only when requested.

Responsibilities:

- UI
- analytics queries
- chart rendering
- settings
- export
- deletion

Closing dashboard must not stop collector.

Implementation options:

### Preferred architecture

Single Tauri process with lightweight background runtime and lazy-loaded WebView.

Alternative:

Separate `trace-agent.exe` and `trace.exe`.

For long-term architecture, the separate executable approach is cleaner.

Recommended:

```text
trace-agent.exe
trace.exe
```

---

# 4. Technology Stack

## Collector

Rust

Recommended crates/modules:

- windows / windows-sys
- rusqlite or sqlx
- tokio where asynchronous tasks are required
- serde
- chrono/time
- tracing
- anyhow / thiserror

Avoid large runtime dependencies where possible.

---

# 5. Desktop UI

Tauri 2.x

Frontend:

React  
TypeScript  
Vite

State:

Zustand or lightweight React state.

Avoid Redux unless complexity actually requires it.

---

# 6. Visualization

Preferred:

Apache ECharts

Reasons:

- strong heatmap support
- performant large datasets
- extensive chart types

Alternative:

Recharts

For complex heatmaps ECharts is preferable.

---

# 7. Database

SQLite.

Configuration:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=ON;
```

Avoid:

```sql
synchronous=FULL
```

for every telemetry write because it creates unnecessary disk overhead.

---

# 8. Windows Input Capture

Use Win32 APIs.

Possible APIs:

- SetWindowsHookEx
- WH_MOUSE_LL

or

Raw Input API.

Preferred evaluation:

Raw Input is more suitable for high-frequency device telemetry.

Low-level mouse hooks provide convenient click/movement capture but can introduce overhead if callbacks perform work.

Critical design rule:

The input callback must do almost nothing.

Callback:

capture event  
→ timestamp  
→ push into lock-free/bounded queue  
→ return

Never perform:

- database write
- JSON serialization
- analytics
- network operations
- expensive allocations

inside the callback.

---

# 9. Event Pipeline

```text
OS Event
   │
   ▼
Input Listener
   │
   ▼
Bounded Event Queue
   │
   ▼
Sampling Engine
   │
   ▼
Metrics Aggregator
   │
   ▼
Write Buffer
   │
   ▼
SQLite
```

---

# 10. Event Structure

Internal raw event:

```rust
PointerEvent {
    timestamp_ms: i64,
    event_type: EventType,
    x: i32,
    y: i32,
    monitor_id: u16,
    wheel_delta: i16,
    button: Option<MouseButton>
}
```

EventType:

```text
Move
ButtonDown
ButtonUp
Wheel
HorizontalWheel
```

Derived:

```text
Click
DoubleClick
Drag
```

---

# 11. Sampling Strategy

Do not persist every mouse movement event.

Mouse hardware may produce hundreds or thousands of updates per second.

Instead, process every incoming event transiently but persist sampled/aggregated information.

Suggested initial movement sampling:

Store/update analytics if one of:

```text
elapsed >= 25 ms

OR

distance >= 6 px

OR

direction change >= configurable threshold
```

Do not discard click/button events.

All button events remain event-accurate.

---

# 12. Distance Algorithm

For two positions:

```text
dx = x2 - x1
dy = y2 - y1

distance = sqrt(dx² + dy²)
```

Optimization:

Use `hypot()` or equivalent.

Update cumulative metrics incrementally.

Do not query previous positions from SQLite.

Maintain in-memory state:

```text
last_x
last_y
last_timestamp
total_distance
```

---

# 13. Physical Distance Conversion

Pixel distance is exact relative to screen coordinates.

Physical distance is approximate.

If monitor dimensions/DPI are available:

```text
inches = pixels / DPI

meters = inches × 0.0254
```

Store raw pixel distance as canonical value.

Convert only for presentation.

This avoids corrupting historical data when DPI changes.

---

# 14. Normalized Coordinates

Heatmaps must not depend on display resolution.

Normalized coordinates:

```text
nx = (x - monitor_left) / monitor_width
ny = (y - monitor_top) / monitor_height
```

Range:

0.0 → 1.0

---

# 15. Heatmap Aggregation

Do not store every coordinate indefinitely.

Use grid:

```text
64 × 36
```

For each sample:

```text
grid_x = floor(nx × 64)
grid_y = floor(ny × 36)
```

Increment:

```text
dwell_count
click_count
```

Heatmap table:

```sql
CREATE TABLE heatmap_hourly (
    hour_start INTEGER NOT NULL,
    monitor_id INTEGER NOT NULL,
    grid_x INTEGER NOT NULL,
    grid_y INTEGER NOT NULL,
    dwell_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    PRIMARY KEY (
        hour_start,
        monitor_id,
        grid_x,
        grid_y
    )
);
```

---

# 16. Click Detection

Track button-down and button-up.

Click occurs if:

- down → up
- movement below drag threshold
- duration below click threshold

Windows already provides double-click timing configuration.

Prefer reading OS configuration where possible.

---

# 17. Drag Detection

Drag begins when:

button held

AND

movement > threshold

Suggested threshold:

4–8 px.

Track:

```text
drag_start_time
drag_end_time
drag_distance
button
```

---

# 18. Scroll Processing

Store wheel delta.

Windows standard wheel step commonly uses multiples of 120.

Keep native wheel delta.

Derived metrics:

```text
wheel_steps
scroll_events
scroll_direction
scroll_bursts
```

Avoid pretending raw wheel delta directly represents physical kilometers unless using clearly documented estimation.

A safer UI metric is:

```text
scroll steps
```

or approximate viewport distance if supported.

---

# 19. Idle Detection

Maintain:

```text
last_interaction_timestamp
```

Interaction types:

- movement
- click
- scroll
- drag

Default:

```text
idle_threshold = 300 seconds
```

State machine:

```text
ACTIVE
  │
  │ inactivity >= threshold
  ▼
IDLE
  │
  │ interaction
  ▼
ACTIVE
```

---

# 20. Session Engine

Session starts:

First interaction after launch or idle.

Session ends:

Idle threshold reached.

Session:

```rust
Session {
    id,
    start_time,
    end_time,
    active_seconds,
    distance_px,
    left_clicks,
    right_clicks,
    middle_clicks,
    scroll_units,
    drag_count
}
```

---

# 21. Activity Intensity

Do not call this productivity.

Suggested normalized score:

```text
movement component
click component
scroll component
active component
```

Normalize against personal historical percentiles where sufficient data exists.

MVP can simply render raw activity density instead of an arbitrary score.

This avoids inventing misleading mathematics.

---

# 22. Cursor Efficiency

Between interaction targets:

Previous click:

A

Next click:

B

Track path between clicks.

```text
direct_distance = distance(A, B)

path_distance =
Σ movement segment distance
```

Then:

```text
efficiency =
direct_distance / path_distance
```

Clamp:

```text
0 <= efficiency <= 1
```

Ignore samples where:

```text
direct_distance < 20 px
```

because micro-movements introduce noise.

---

# 23. Speed

For each sampled segment:

```text
speed =
distance_px / elapsed_seconds
```

Ignore intervals:

```text
elapsed <= 0
```

Calculate aggregate:

- average
- maximum
- p50
- p95

Peak should preferably use p95 in UI because instantaneous max is noisy.

---

# 24. Acceleration

Acceleration:

```text
(current_speed - previous_speed) /
elapsed_time
```

Do not persist every acceleration value.

Aggregate:

- average magnitude
- p95 magnitude

Phase 2 only.

---

# 25. Direction Change

Calculate direction:

```text
angle =
atan2(dy, dx)
```

Direction delta:

```text
abs(angle2 - angle1)
```

Normalize circular difference.

Increment meaningful direction change when:

```text
delta > 30°
```

and movement length exceeds noise threshold.

---

# 26. Movement Jitter

Potential future metric.

Calculate small high-frequency reversals around local regions.

Must be labelled as:

```text
movement variability
```

not medical fatigue.

---

# 27. Database Schema

## schema_version

```sql
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY
);
```

---

## settings

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

---

## sessions

```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    active_seconds INTEGER DEFAULT 0,
    idle_seconds INTEGER DEFAULT 0,
    distance_px REAL DEFAULT 0,
    left_clicks INTEGER DEFAULT 0,
    right_clicks INTEGER DEFAULT 0,
    middle_clicks INTEGER DEFAULT 0,
    double_clicks INTEGER DEFAULT 0,
    drag_count INTEGER DEFAULT 0,
    scroll_delta INTEGER DEFAULT 0
);
```

---

## minute_stats

```sql
CREATE TABLE minute_stats (
    minute_ts INTEGER PRIMARY KEY,
    active_seconds INTEGER DEFAULT 0,
    distance_px REAL DEFAULT 0,
    movement_samples INTEGER DEFAULT 0,
    left_clicks INTEGER DEFAULT 0,
    right_clicks INTEGER DEFAULT 0,
    middle_clicks INTEGER DEFAULT 0,
    double_clicks INTEGER DEFAULT 0,
    drag_count INTEGER DEFAULT 0,
    scroll_delta INTEGER DEFAULT 0,
    max_speed REAL DEFAULT 0
);
```

---

## daily_stats

```sql
CREATE TABLE daily_stats (
    date TEXT PRIMARY KEY,
    active_seconds INTEGER DEFAULT 0,
    idle_seconds INTEGER DEFAULT 0,
    distance_px REAL DEFAULT 0,
    left_clicks INTEGER DEFAULT 0,
    right_clicks INTEGER DEFAULT 0,
    middle_clicks INTEGER DEFAULT 0,
    double_clicks INTEGER DEFAULT 0,
    drag_count INTEGER DEFAULT 0,
    scroll_delta INTEGER DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    average_speed REAL DEFAULT 0,
    peak_speed REAL DEFAULT 0
);
```

---

## monitor

```sql
CREATE TABLE monitors (
    monitor_id INTEGER PRIMARY KEY,
    device_name TEXT,
    width INTEGER,
    height INTEGER,
    dpi_x REAL,
    dpi_y REAL,
    first_seen INTEGER,
    last_seen INTEGER
);
```

---

# 28. Raw Event Storage

MVP recommendation:

Do not persist all raw movement events.

Persist raw events only for:

- click
- drag
- optional debugging mode

If raw sampled movement is desired:

retain for 24 hours maximum.

Example:

```sql
CREATE TABLE raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    event_type INTEGER NOT NULL,
    x_norm REAL,
    y_norm REAL,
    monitor_id INTEGER
);
```

Index:

```sql
CREATE INDEX idx_events_ts
ON raw_events(ts);
```

---

# 29. Database Write Strategy

Never insert on every mouse movement.

Maintain:

```text
in-memory aggregates
```

Flush:

every 5–15 seconds

OR

when buffer reaches threshold.

Suggested:

10-second flush.

Click events may be accumulated into the same bucket.

---

# 30. Crash Safety

SQLite WAL provides crash resilience.

Collector maintains small in-memory buffers.

Worst expected loss:

<10 seconds of aggregate data.

On clean shutdown:

flush immediately.

---

# 31. Startup Registration

Windows startup options:

Preferred:

Current-user startup registration.

Possible mechanisms:

- Registry Run key
- Startup task
- Tauri autostart plugin

MVP:

Use current-user startup.

Avoid Windows Service.

Reasons:

- desktop-session interaction hooks
- complexity
- permissions
- service isolation

---

# 32. System Tray

Tray menu:

```text
Open Trace
Tracking: On
Pause 15 min
Pause 1 hour
Resume
Settings
Exit
```

Exit must clearly distinguish:

Close dashboard

vs

Stop Trace completely.

---

# 33. IPC Architecture

Dashboard communicates with collector using:

Preferred:

Local named pipe.

Alternative:

Localhost HTTP.

Named pipe advantages:

- no network listener
- lower attack surface
- clean Windows integration

Messages:

```text
GET_STATUS
GET_TODAY
GET_RANGE
GET_SESSIONS
PAUSE
RESUME
EXPORT
DELETE_RANGE
```

---

# 34. API Contract

Conceptually:

```text
get_today()
get_daily_range(start, end)
get_sessions(start, end)
get_heatmap(start, end, monitor)
get_current_session()
pause_tracking(duration)
resume_tracking()
delete_range(start, end)
export_data(format, range)
```

Tauri commands may wrap these operations.

---

# 35. Dashboard Data Flow

```text
React UI
   │
   ▼
Tauri Command
   │
   ▼
Rust Query Layer
   │
   ▼
SQLite
```

Do not expose direct database access from JavaScript.

---

# 36. UI State

Frontend state categories:

```text
dashboard data
selected date range
selected monitor
settings
tracking state
```

Use lightweight store.

Recommended:

Zustand.

---

# 37. Dashboard Routes

```text
/
 /activity
 /movement
 /clicks
 /heatmap
 /sessions
 /history
 /insights
 /settings
```

---

# 38. Dashboard Performance

Charts should query aggregated tables.

Never load millions of raw events into React.

Example:

30-day dashboard:

query daily_stats

24-hour dashboard:

query minute_stats

heatmap:

query heatmap_hourly

---

# 39. Data Retention Worker

Run maintenance approximately once per day.

Actions:

```text
delete raw events older than 24h

optionally compact minute data

VACUUM only occasionally
```

Do not run VACUUM frequently because it is expensive.

---

# 40. Logging

Use structured local logs.

Levels:

ERROR  
WARN  
INFO

Disable verbose movement logging in production.

Never log:

coordinates continuously

or user-sensitive context.

Rotate logs.

Example:

5 MB × 3 files.

---

# 41. Error Handling

Collector must recover from:

- database temporarily locked
- monitor disconnected
- monitor resolution changed
- sleep
- resume
- user session lock
- user session unlock
- display scaling changes

---

# 42. Sleep / Resume

When Windows suspends:

flush current aggregate.

Upon resume:

do not calculate distance between the last pre-sleep cursor position and new post-resume cursor position.

Reset movement anchor.

Otherwise huge false distances may be generated.

---

# 43. Multi-Monitor Coordinates

Windows uses virtual desktop coordinates.

Potential negative positions:

```text
Monitor A
x = -1920 → -1

Monitor B
x = 0 → 1919
```

Never assume:

```text
x >= 0
y >= 0
```

Always identify containing monitor.

Normalize coordinates per monitor.

---

# 44. DPI Scaling

Windows scaling may use:

100%

125%

150%

etc.

Declare the application DPI-aware.

Prefer physical pixel coordinates internally.

Record monitor metadata separately.

---

# 45. Security

No network listener by default.

No cloud APIs.

Database stored under user app-data directory.

Example:

```text
%LOCALAPPDATA%\Trace\
```

Files:

```text
trace.db
trace.log
settings.json
```

Protect against accidental cross-user access using normal Windows user permissions.

---

# 46. Privacy Architecture

Collector is prohibited from reading:

- keyboard input
- screen pixels
- clipboard
- browser data
- filesystem documents

Optional active-application tracking must be separately gated.

---

# 47. Export

JSON structure:

```json
{
  "schema_version": 1,
  "range": {
    "start": "2026-10-01",
    "end": "2026-10-03"
  },
  "daily": [],
  "sessions": []
}
```

CSV files:

```text
daily.csv
sessions.csv
minute_stats.csv
```

---

# 48. Deletion

Deletion should occur in a transaction.

Example:

```text
BEGIN

DELETE target raw rows
DELETE target minute stats
DELETE target heatmaps
DELETE target sessions
DELETE target daily stats

COMMIT
```

Recalculate partially affected daily aggregates where required.

---

# 49. Configuration

Suggested settings:

```text
launch_at_login
tracking_enabled
idle_threshold_seconds
raw_retention_hours
minute_retention_days
theme
accent_color
distance_unit
application_tracking_enabled
```

---

# 50. Application Directory Structure

```text
trace/
│
├── apps/
│   └── desktop/
│       ├── src/
│       ├── components/
│       ├── routes/
│       └── charts/
│
├── crates/
│   ├── trace-agent/
│   ├── trace-core/
│   ├── trace-storage/
│   ├── trace-metrics/
│   └── trace-ipc/
│
├── migrations/
│
├── tests/
│
├── Cargo.toml
│
└── package.json
```

---

# 51. Rust Module Structure

```text
trace-agent
│
├── input
│   ├── mouse.rs
│   ├── monitor.rs
│   └── windows.rs
│
├── sampling
│   └── sampler.rs
│
├── metrics
│   ├── distance.rs
│   ├── clicks.rs
│   ├── sessions.rs
│   ├── speed.rs
│   └── heatmap.rs
│
├── storage
│   ├── sqlite.rs
│   ├── migrations.rs
│   └── repository.rs
│
├── ipc
│
├── startup
│
└── main.rs
```

---

# 52. Testing Strategy

## Unit Tests

Test:

- distance
- normalization
- session detection
- idle detection
- efficiency
- heatmap grid mapping
- scroll aggregation
- date boundaries

---

## Integration Tests

Simulated event stream:

```text
move
move
click
move
scroll
idle
resume
```

Verify database aggregates.

---

## Performance Tests

Synthetic:

1000 pointer events/sec.

Measure:

- CPU
- RAM
- queue backlog
- write latency

Collector must remain stable.

---

## Long-Running Test

Run:

24–72 hours.

Check:

- memory leaks
- database growth
- CPU drift
- corrupted sessions
- clock/date rollover

---

# 53. Edge Cases

Must explicitly test:

1. Computer sleeps overnight.
2. Midnight occurs during active session.
3. Monitor disconnected.
4. Resolution changes.
5. DPI scaling changes.
6. User pauses tracking.
7. Collector crashes.
8. Database becomes temporarily unavailable.
9. Mouse moves between monitors.
10. Mouse coordinates become negative.
11. System time changes.
12. Daylight-saving changes in future cross-platform support.
13. Rapid clicking.
14. High polling-rate gaming mouse.

---

# 54. Performance Budget

Collector target:

```text
RAM
Ideal: 10–20 MB
Maximum target: 30 MB
```

CPU:

```text
Idle:
<0.2%

Normal movement:
<0.5%

Extreme event load:
<2%
```

Disk:

Typical telemetry:

<5–20 MB/month depending on retention.

The architecture should target much less than one raw-event database.

---

# 55. Development Phases

## Phase 1 — Core Telemetry

Build:

- Rust collector
- Windows event capture
- clicks
- movement
- distance
- scrolling
- SQLite

No fancy UI.

---

## Phase 2 — Aggregation

Implement:

- minute stats
- sessions
- idle detection
- heatmaps
- daily statistics

---

## Phase 3 — Desktop Dashboard

Build:

- Tauri shell
- React UI
- Overview
- Activity
- Movement
- Clicks

---

## Phase 4 — Historical Analytics

Build:

- date ranges
- trends
- comparisons
- sessions
- heatmaps

---

## Phase 5 — System Integration

Implement:

- launch at login
- tray icon
- pause/resume
- sleep/resume handling
- exports
- deletion

---

## Phase 6 — Advanced Analytics

Implement:

- efficiency
- baselines
- anomaly detection
- personal records
- weekly wrapped

---

# 56. MVP Implementation Order

Build in this exact sequence:

```text
1. Windows pointer listener
2. Event queue
3. Distance calculation
4. Click detection
5. Scroll collection
6. SQLite schema
7. Buffered aggregation
8. Idle detection
9. Sessions
10. Heatmap aggregation
11. Startup registration
12. Tray application
13. Tauri dashboard
14. Overview analytics
15. History
16. Export/delete
17. Performance optimization
18. Installer
```

Do not begin with dashboard visuals.

The hard part of this product is:

**high-frequency reliable telemetry with negligible resource usage.**

The UI is comparatively straightforward.

---

# 57. MVP Definition of Done

The engineering MVP is complete only when:

```text
✓ Starts at Windows login
✓ Runs continuously
✓ Survives sleep/resume
✓ Tracks clicks accurately
✓ Tracks movement accurately
✓ Calculates distance
✓ Calculates sessions
✓ Tracks scrolling
✓ Generates heatmaps
✓ Persists to SQLite
✓ Uses buffered writes
✓ Uses <30 MB collector RAM
✓ Normal CPU <1%
✓ Dashboard operates independently
✓ Supports pause/resume
✓ Supports history
✓ Supports export
✓ Supports deletion
✓ Collects no keyboard/screen content
```