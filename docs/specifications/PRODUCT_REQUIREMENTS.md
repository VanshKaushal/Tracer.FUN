Trace Bar — Product + Technical Specification
0. Architectural decision
The existing Trace architecture becomes:
                        TRACE

┌───────────────────────────────────────────────────────┐
│                    Windows Session                    │
│                                                       │
│   Mouse / Trackpad / System Events                    │
│                │                                      │
│                ▼                                      │
│        ┌──────────────────┐                           │
│        │ trace-agent.exe  │                           │
│        │ Rust             │                           │
│        │                  │                           │
│        │ Input Capture    │                           │
│        │ Aggregation      │                           │
│        │ Sessions         │                           │
│        │ Metrics          │                           │
│        └────────┬─────────┘                           │
│                 │                                     │
│        ┌────────┴───────────┐                         │
│        │                    │                         │
│        ▼                    ▼                         │
│   SQLite / WAL         Local IPC                      │
│                             │                         │
│                    ┌────────┴────────┐                │
│                    │                 │                │
│                    ▼                 ▼                │
│             ┌────────────┐    ┌──────────────┐       │
│             │ Trace Bar  │    │ Dashboard    │       │
│             │ Always-on  │    │ Tauri/React  │       │
│             │ overlay    │    │ Full UI      │       │
│             └────────────┘    └──────────────┘       │
└───────────────────────────────────────────────────────┘

The critical rule is:
Trace Bar must never become the telemetry engine.

If the bar crashes or closes:
Tracking ✓
Database ✓
Sessions ✓
Analytics ✓
Trace Bar ✕

The collector stays alive.
1. Trace Bar PRD Addendum
1.1 Product definition
Trace Bar is a small, persistent, edge-docked desktop surface providing instant access to Trace without opening the full dashboard.
It serves four purposes:
1. Show current tracking state.
2. Show lightweight live statistics.
3. Expose high-frequency actions.
4. Surface important interaction insights.
It should feel closer to Wispr Flow / Raycast than a traditional Windows floating toolbar.
2. Product goals
The bar must allow the user to answer:
Is Trace running?

How long have I been active?

How many clicks have I made?

How far has my cursor travelled?

How long is this session?

Can I pause tracking instantly?

Can I open my analytics instantly?

without opening the main application.
3. Non-goals
Trace Bar is not:
- a second dashboard
- a giant floating panel
- an always-visible analytics window
- an advertisement surface
- a chat assistant
- a Windows notification replacement for everything
- a recorder
- a screen-capture widget
Its job is fast access, not information overload.
4. Trace Bar states
Use four visual states.
State A — Peek
Default dormant state.
Screen edge │ ◐

Approximately 14–20 px exposed.
Used when:
- user hasn't interacted with the bar
- no notification exists
- no focus session is running
Purpose:
Almost zero visual distraction.
State B — Compact
Mouse hover or keyboard invocation:
┌────┐
│ ●  │
└────┘

Optional live timer:
┌────────┐
│ ● 43m  │
└────────┘

State C — Expanded
Click compact state:
╭─────────────────────╮
│ TRACE          ● ON │
│                     │
│  01:43              │
│  CURRENT SESSION    │
│                     │
│  1,842      617 m   │
│  CLICKS      CURSOR │
│                     │
│  8,240      6h 12m  │
│  SCROLL      ACTIVE │
│                     │
│  ⏸     ◎     ↗     ⚙│
╰─────────────────────╯

Actions:
⏸ Pause / Resume
◎ Focus / Mark session
↗ Open dashboard
⚙ Settings

State D — Contextual card
Temporary expansion triggered by an event.
Example:
╭──────────────────────────╮
│ ★ PERSONAL RECORD        │
│                          │
│ 5,000 clicks today       │
│                          │
│            View details  │
╰──────────────────────────╯

Then automatically collapse.
5. Functional requirements
TB-F01 — Always-on-top
Trace Bar remains above normal windows.
TB-F02 — Edge docking
Support:
LEFT
RIGHT
BOTTOM

Do not support top initially.
Why:
- conflicts with browser chrome
- title bars
- macOS-inspired layout assumptions
- taskbar variations
- notification regions
Add top later only if requested.
TB-F03 — Dragging
Users can drag the bar.
When released near an edge:
distance_to_edge <= 48px

snap to that edge.
TB-F04 — Position persistence
Remember:
monitor
edge
relative offset

Do not persist only absolute x/y.
Example:
{
  "monitor": "DISPLAY2",
  "edge": "right",
  "offset": 0.46
}

TB-F05 — Multi-monitor
Users can move Trace Bar between monitors.
Its position must survive:
- resolution changes
- scaling changes
- monitor removal
- monitor reconnect
- laptop docking
TB-F06 — Auto-collapse
Default:
Expanded
    ↓ 5 sec inactivity
Compact
    ↓ 3 sec
Peek

Configurable later.
TB-F07 — Pause tracking
Quick actions:
Pause 15 min
Pause 30 min
Pause 1 hour
Pause until resumed

Tracking state should immediately update everywhere.
TB-F08 — Resume
Single-click resume.
TB-F09 — Open dashboard
Should open Trace dashboard directly to:
Overview

or optionally the context being shown.
Example:
Click heatmap insight →
/heatmap?range=today

TB-F10 — Live session timer
Display:
00:42:17

Do not query SQLite every second.
The collector sends session start time; the UI derives the running timer locally.
TB-F11 — Live click count
Update approximately:
1/sec

No reason to render every individual click.
TB-F12 — Live cursor distance
Update:
1/sec

or when meaningful change occurs.
TB-F13 — Daily active time
Display today's cumulative active time.
TB-F14 — Focus session
User presses:
◎

Starts manual session:
FOCUS
00:00

Ending it generates:
Focus session

47m 18s
682 clicks
214m pointer distance
4 app switches

Application-switch metric only exists if application analytics is enabled.
TB-F15 — Incognito mode
Quick temporary privacy mode.
Incognito ON

Collector stops persistence.
Prefer:
events ignored

rather than:
events collected but not displayed

6. Smart events
Trace Bar can surface:
Long session
You've been continuously active for 90 minutes.

Personal record
New longest session this month.

Daily summary
Your Trace day is ready.

Unusual activity
Today's interaction is 32% above your normal Friday range.

Focus completed
52-minute focus session complete.

Do not surface constant notifications.
Maximum recommended unsolicited Trace Bar insight:
1 every 60 minutes

unless explicitly triggered by the user.
7. Fullscreen behavior
This matters enormously.
Default behavior:
Fullscreen game/video/presentation
          ↓
Hide Trace Bar

Settings:
Hide over fullscreen apps     ON
Show during focus sessions    OFF
Show notifications fullscreen OFF

Never annoy someone during:
- gaming
- presentation
- movie
- screen sharing
8. UI dimensions
Suggested compact control:
48 × 48 px

Peek:
18 × 48 px

Expanded:
260–300 px wide
300–360 px tall

Bottom mode:
320–420 px wide
64–84 px tall

Example:
╭──────────────────────────────────╮
│ ●  43m    1.8k clicks    ⏸ ◎ ↗ │
╰──────────────────────────────────╯

9. Visual system
Continue Trace's existing design system.
Background
#0A0A0A

Primary text
#F4F4F5

Secondary text
#8A8A8A

Border
rgba(255,255,255,0.08)

Radius
Compact: 18–24px
Expanded: 20–24px

Avoid excessive glassmorphism.
Use subtle:
- blur
- shadow
- border
- one accent color
10. Animation specification
Animations must be GPU-friendly.
Target:
150–220 ms

Use:
transform
opacity
scale

Avoid expensive repeated:
box-shadow
filter
layout recalculations

Expansion:
Peek
 ↓
Compact
 ↓
Expanded

scale .96 → 1
opacity .7 → 1

11. Accessibility
Trace Bar must support keyboard operation.
Potential global shortcut:
Ctrl + Shift + T

or configurable.
Invocation:
shortcut
   ↓
Trace Bar expands

Keyboard:
Tab        next control
Enter      activate
Esc        collapse

Do not globally hijack common shortcuts by default.
12. Trace Bar TRD
12.1 Component architecture
Add:
trace/
│
├── crates/
│   ├── trace-agent/
│   ├── trace-core/
│   ├── trace-storage/
│   ├── trace-metrics/
│   ├── trace-ipc/
│   └── trace-platform-windows/
│
├── apps/
│   └── desktop/
│       ├── dashboard/
│       └── trace-bar/
│
└── migrations/

13. Window implementation strategy
For V1:
Tauri + lightweight React Trace Bar window
Reasons:
- same stack
- faster implementation
- easy animation
- shared UI infrastructure
- simple distribution
But keep the Trace Bar bundle tiny.
Do not import the entire dashboard.
Separate entry point:
src/
├── dashboard/
│
└── trace-bar/
    ├── TraceBar.tsx
    ├── CompactBar.tsx
    ├── ExpandedBar.tsx
    ├── InsightCard.tsx
    └── store.ts

14. Future native optimization
If measurement shows the WebView overlay uses excessive RAM:
Phase 2 migration:
Trace Bar UI
Tauri/WebView
      ↓
Native Rust rendering

Possible native technologies:
Win32 + Direct2D
Slint

But do not start there.
It would add engineering complexity before proving the UX.
15. Window flags
Conceptually:
decorations = false
transparent = true
always_on_top = true
resizable = false
skip_taskbar = true

Windows-specific refinement may use:
WS_EX_TOOLWINDOW

and where appropriate:
WS_EX_NOACTIVATE

Be careful with WS_EX_NOACTIVATE.
It should be used only where the bar does not need keyboard focus.
Recommended:
Peek / Compact
→ no-activate behavior

Expanded interactive UI
→ allow activation when required

16. Focus stealing rules
Opening or hovering Trace Bar must not unnecessarily deactivate:
VS Code
Figma
browser
game
terminal

Expected:
hover
→ no focus change

peek → compact
→ no focus change

click quick action
→ minimal focus impact

open dashboard
→ normal activation

17. Monitor detection
Windows:
MonitorFromPoint
MonitorFromWindow
GetMonitorInfo

Use:
rcWork

instead of full monitor dimensions when docking.
This prevents overlapping the taskbar.
18. Position model
Persist:
enum DockEdge {
    Left,
    Right,
    Bottom
}

struct BarPosition {
    monitor_id: String,
    edge: DockEdge,
    offset: f32,
}

Where:
0.0 <= offset <= 1.0

19. Monitor identity
Do not rely only on monitor array index.
Bad:
monitor = 2

Better:
device_name
+
display identifier

Example:
\\.\DISPLAY2

Fallback:
primary monitor.
20. Docking algorithm
When drag ends:
left_distance
right_distance
bottom_distance

Compute minimum.
If:
min_distance <= SNAP_THRESHOLD

dock.
Recommended:
SNAP_THRESHOLD = 48px

Then calculate:
offset =
positionAlongEdge /
availableEdgeLength

Clamp bar within working area.
21. Peek implementation
Do not leave a giant transparent window covering the screen.
Bad:
300 × 400 transparent window
only 20 px visible

It may intercept clicks.
Instead resize/reposition actual window:
Peek     ~20 × 48
Compact  ~52 × 52
Expanded ~280 × 340

This is important.
22. Trace Bar state machine
                  ┌─────────────┐
                  │    PEEK     │
                  └──────┬──────┘
                         │ hover
                         ▼
                  ┌─────────────┐
          ┌──────▶│   COMPACT   │◀─────────┐
          │       └──────┬──────┘          │
          │              │ click           │
          │              ▼                 │
          │       ┌─────────────┐          │
 inactivity       │  EXPANDED   │          │
          │       └──────┬──────┘          │
          │              │ event           │
          │              ▼                 │
          │       ┌─────────────┐          │
          └───────│ CONTEXTUAL  │──────────┘
                  └─────────────┘

Separate tracking state:
TRACKING
PAUSED
INCOGNITO

Separate focus state:
NO_FOCUS_SESSION
FOCUS_ACTIVE
FOCUS_COMPLETED

Do not combine these into one giant state enum.
23. IPC architecture
Use local IPC.
Preferred:
Named Pipes

Example:
\\.\pipe\trace-agent

Advantages:
- local-only
- no TCP port
- no firewall dialogue
- small attack surface
- appropriate Windows IPC
24. IPC communication model
Use two channels conceptually:
COMMANDS
UI → agent

EVENTS
agent → UI

Example:
Trace Bar
   │
   ├── pause()
   ├── resume()
   ├── start_focus()
   └── end_focus()

trace-agent
   │
   ├── tracking_state_changed
   ├── live_stats
   ├── session_changed
   └── insight

25. Live telemetry contract
Example:
{
  "type": "live_stats",
  "timestamp": 1791039012000,
  "tracking": true,
  "session": {
    "start": 1791036240000,
    "activeSeconds": 2772
  },
  "today": {
    "leftClicks": 1824,
    "rightClicks": 93,
    "cursorDistancePx": 2540934,
    "activeSeconds": 22314,
    "scrollDelta": 153840
  }
}

Emit approximately:
1 Hz

not per input event.
26. Command contract
Example commands:
GET_STATUS
GET_LIVE_STATS

PAUSE_TRACKING
RESUME_TRACKING

ENABLE_INCOGNITO
DISABLE_INCOGNITO

START_FOCUS
END_FOCUS

OPEN_DASHBOARD

SET_BAR_POSITION

GET_BAR_SETTINGS
SET_BAR_SETTINGS

27. Rust model
struct LiveStats {
    timestamp_ms: i64,
    tracking_state: TrackingState,
    session: Option<LiveSession>,
    today: TodayMetrics,
}

struct TodayMetrics {
    left_clicks: u64,
    right_clicks: u64,
    middle_clicks: u64,
    distance_px: f64,
    active_seconds: u64,
    scroll_delta: i64,
}

28. No polling SQLite
Do not implement:
React
 ↓ every second
SQLite SELECT

Instead:
collector in-memory state
        ↓
      IPC push
        ↓
Trace Bar

SQLite remains persistence.
The collector is the real-time source of truth.
29. Dashboard synchronization
Both:
Trace Bar
Dashboard

subscribe to the same agent state.
Therefore:
Pause in Trace Bar
       ↓
Agent
       ↓
tracking_state_changed
       ↓
Trace Bar updates
Dashboard updates

No duplicated state.
30. New settings
Add:
trace_bar_enabled
trace_bar_edge
trace_bar_monitor
trace_bar_offset
trace_bar_auto_collapse
trace_bar_hide_fullscreen
trace_bar_show_live_timer
trace_bar_show_clicks
trace_bar_show_distance
trace_bar_notifications
trace_bar_focus_mode

31. Settings UI
Add new section:
Settings
 ├── Tracking
 ├── Privacy
 ├── Data
 ├── Trace Bar
 └── Appearance

Trace Bar settings:
Show Trace Bar               ON

Launch with Trace            ON

Auto collapse                ON

Hide in fullscreen           ON

Position                     Right

Live session timer           ON

Click count                  ON

Cursor distance              ON

Insights                     ON

Personal records             ON

32. Database changes
Bar position itself does not need telemetry tables.
Store preferences in:
settings

Existing table:
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

Examples:
trace_bar.edge       right
trace_bar.offset     0.46
trace_bar.monitor    \\.\DISPLAY2

33. Focus session table
Add:
CREATE TABLE focus_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    active_seconds INTEGER DEFAULT 0,
    distance_px REAL DEFAULT 0,
    left_clicks INTEGER DEFAULT 0,
    right_clicks INTEGER DEFAULT 0,
    scroll_delta INTEGER DEFAULT 0,
    context_switches INTEGER DEFAULT 0
);

34. Insight table
Optional, but useful:
CREATE TABLE insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    shown INTEGER DEFAULT 0,
    dismissed INTEGER DEFAULT 0
);

Don't store dozens of trivial notifications.
Only durable insights.
35. System events
Collector should already handle:
login
logout
sleep
resume
lock
unlock
display-change
DPI-change
shutdown

Trace Bar additionally responds to:
monitor connected
monitor disconnected
taskbar relocation
fullscreen detected
foreground application change

36. Fullscreen detection
On foreground-window change:
foreground HWND
       ↓
window rect
       ↓
monitor bounds
       ↓
covers monitor?

If fullscreen:
hide bar

unless user overrides.
Do not continuously poll at high frequency.
React to foreground changes or use low-frequency checks.
37. Performance budgets
New overall targets:
Component	RAM target	CPU normal
trace-agent	<30 MB	<1%
Trace Bar	<40 MB target	<0.3%
Dashboard	<150 MB	only while open


The Trace Bar budget is important.
If Tauri/WebView exceeds acceptable memory consistently, that's the signal to move the bar renderer native.
Do not pretend WebView2 will consume 5 MB. It won't.
38. Rendering rules
When unchanged:
no animation
no chart rendering
no timers except session display

Update UI:
1 Hz max

for live numbers.
Do not render movement coordinates.
39. Security
Named pipe permissions should be scoped to the current user.
Trace Bar must not expose remote access.
No:
0.0.0.0
localhost web API
WebSocket port

just for the overlay.
40. Privacy
Trace Bar must never display sensitive application context while screen sharing by default.
If app analytics later shows:
VS Code
Chrome
Figma

provide:
Hide app names in Trace Bar

Default:
ON.
41. Incognito behavior
When activated:
Trace Bar
   ↓
ENABLE_INCOGNITO
   ↓
Agent
   ↓
finish current aggregate
   ↓
stop persistence

UI clearly indicates:
○ INCOGNITO

When disabled:
new session begins.
Do not retroactively store events collected during Incognito.
42. Failure handling
If collector connection dies:
Trace Bar changes from:
● Tracking

to:
! Trace unavailable

Attempt reconnect with backoff:
1s
2s
5s
10s
30s

Don't spin constantly.
43. Restart behavior
If Trace Bar crashes:
Agent notices disconnect

Collector continues.
Optional supervisor can restart UI.
If agent crashes:
bar surfaces:
Tracking stopped
Restart Trace

44. Analytics event flow
Example click:
Windows
   ↓
Raw Input
   ↓
trace-agent
   ↓
metrics increment
   ↓
memory aggregate
   ↓
10-sec SQLite flush
   ↓
1-sec LiveStats IPC
   ↓
Trace Bar

The click itself never travels through React.
That is essential.
45. Interaction flow
Pause
User clicks pause
       ↓
Trace Bar sends command
       ↓
Agent changes tracking state
       ↓
Agent broadcasts new state
       ↓
Trace Bar turns gray
       ↓
Dashboard reflects pause

Focus
User presses ◎
       ↓
START_FOCUS
       ↓
Agent creates focus session
       ↓
Trace Bar starts timer
       ↓
User presses stop
       ↓
END_FOCUS
       ↓
Agent calculates final metrics
       ↓
Summary displayed

46. Drag behavior
Dragging must not conflict with button clicks.
Suggested behavior:
pointer down

movement < 6px
→ click

movement >= 6px
→ drag

During drag:
disable auto-collapse
disable hover expansion

On release:
snap
persist position

47. Edge-specific layouts
Right
                ╭────╮
                │ ●  │
                │ ◎  │
                │ ↗  │
                ╰────╯

Expanded panel grows leftward.
Left
╭────╮
│ ●  │
│ ◎  │
│ ↗  │
╰────╯

Expanded panel grows rightward.
Bottom
             ╭─────────────────╮
             │ ●  42m  ⏸ ◎ ↗ │
             ╰─────────────────╯

Expanded panel grows upward.
48. Contextual notification priority
Priority hierarchy:
P0
Critical collector failure

P1
Tracking state change requested by user

P2
Focus completion

P3
Long-session reminder

P4
Personal record / insight

Lower-priority events must never replace higher-priority ones.
49. Notification queue
Maximum:
3

Don't create a notification backlog.
Expiry:
Insight: 5–8 sec
Focus complete: until interaction / 15 sec
Critical: persistent

50. Repo changes
Recommended final structure:
trace/
│
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── dashboard/
│       │   │
│       │   ├── trace-bar/
│       │   │   ├── components/
│       │   │   │   ├── Peek.tsx
│       │   │   │   ├── Compact.tsx
│       │   │   │   ├── Expanded.tsx
│       │   │   │   ├── FocusTimer.tsx
│       │   │   │   └── InsightCard.tsx
│       │   │   │
│       │   │   ├── hooks/
│       │   │   ├── store/
│       │   │   ├── animations/
│       │   │   └── TraceBar.tsx
│       │   │
│       │   ├── shared/
│       │   └── settings/
│       │
│       └── src-tauri/
│
├── crates/
│   ├── trace-agent/
│   ├── trace-core/
│   ├── trace-metrics/
│   ├── trace-storage/
│   ├── trace-ipc/
│   └── trace-platform-windows/
│
├── migrations/
│
├── tests/
│   ├── telemetry/
│   ├── ipc/
│   ├── trace-bar/
│   └── performance/
│
└── docs/
    ├── PRD.md
    ├── TRD.md
    ├── TRACE_BAR_SPEC.md
    ├── IPC_SPEC.md
    ├── DATA_MODEL.md
    └── TEST_PLAN.md

51. Test specification
Trace Bar needs explicit tests for:
Window
- launches
- always-on-top
- absent from taskbar
- correct initial monitor
- correct edge
- survives resolution change
Docking
- left snap
- right snap
- bottom snap
- no snap outside threshold
- persistent offset
- monitor transfer
State
- peek
- compact
- expanded
- notification
- pause
- incognito
- focus
Fullscreen
- hides on game
- hides on video
- returns afterward
Collector failure
- disconnect detected
- reconnect works
- tracking indicator correct
Performance
- idle 8 hours
- 1,000 mouse events/sec
- repeated expand/collapse
- multi-monitor changes
- 24-hour run
52. Acceptance criteria
Trace Bar is production-ready only when:
✓ Automatically starts with Trace
✓ Tracking works without dashboard
✓ Bar works without dashboard
✓ Dashboard works without Bar
✓ Bar can be disabled completely

✓ Supports left/right/bottom docking
✓ Position persists
✓ Multi-monitor works
✓ DPI scaling works
✓ Taskbar position respected

✓ Bar doesn't constantly steal focus
✓ Fullscreen auto-hide works
✓ Auto-collapse works

✓ Pause/resume works
✓ Incognito works
✓ Focus session works
✓ Live statistics work

✓ Collector remains <30 MB target
✓ UI update frequency <= 1 Hz
✓ No raw pointer stream sent to UI
✓ No database polling every second

✓ Collector crash is visible
✓ Bar crash doesn't stop collector
✓ Sleep/resume works

✓ No keyboard capture
✓ No screenshots
✓ No clipboard capture
✓ No remote telemetry

53. Development order
Do it in this order.
Phase 1 — Window prototype
Build only:
floating window
always-on-top
dragging
edge snap
multi-monitor
position persistence

Nothing else.
Phase 2 — Agent IPC
Implement:
named pipe
connection
GET_STATUS
live stats
pause
resume

Phase 3 — Trace Bar UI
Build:
Peek
Compact
Expanded
Animations

Phase 4 — Integration
Connect:
live session
clicks
distance
active time
tracking state

Phase 5 — System intelligence
Add:
fullscreen detection
lock/unlock
sleep/resume
monitor changes

Phase 6 — Focus
Implement:
manual focus sessions
focus summary
focus history

Phase 7 — Privacy
Implement:
Incognito
quick pause
notification settings

Phase 8 — Smart insights
Only after historical analytics exist:
records
long sessions
personal baseline
anomalies
daily summary

54. What NOT to do first
Do not start with:
AI
LLM summaries
fancy heatmap animations
plugin system
cloud sync
accounts
social sharing
gamification
achievements

None of those matter until these three things are excellent:
Telemetry reliability
        +
Low resource consumption
        +
Trace Bar UX

55. Updated final Trace product
Once this is integrated, Trace becomes:
TRACE
│
├── Always-running Agent
│   ├── Pointer telemetry
│   ├── Clicks
│   ├── Scrolling
│   ├── Sessions
│   ├── Idle detection
│   ├── Heatmaps
│   ├── Efficiency
│   └── Aggregation
│
├── Trace Bar
│   ├── Peek
│   ├── Live session
│   ├── Live stats
│   ├── Pause
│   ├── Incognito
│   ├── Focus
│   ├── Insights
│   └── Dashboard launcher
│
├── Dashboard
│   ├── Overview
│   ├── Activity
│   ├── Movement
│   ├── Clicks
│   ├── Heatmaps
│   ├── Sessions
│   ├── Focus
│   ├── History
│   ├── Insights
│   └── Settings
│
└── Local Data Engine
    ├── SQLite/WAL
    ├── Minute aggregates
    ├── Daily aggregates
    ├── Heatmap buckets
    ├── Focus sessions
    └── Personal baseline