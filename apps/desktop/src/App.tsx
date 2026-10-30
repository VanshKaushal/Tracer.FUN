import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  CirclePause,
  Clock3,
  Crosshair,
  Footprints,
  Gauge,
  Grid2X2,
  History,
  Lightbulb,
  LoaderCircle,
  MousePointer2,
  Play,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
  PanelLeftClose,
  RefreshCw,
  Menu,
} from "lucide-react";
import type { Dashboard, Range, Settings, Stats, Status } from "./types";
import {
  baselineChange,
  clicks,
  dateRange,
  duration,
  emptyStats,
  localDate,
  number,
  percentile,
  pixelDistance,
  convertPixelDistance,
  distanceUnits,
  scrollSteps,
  sumStats,
} from "./metrics";
import { call, desktop, localBrowser, exportData, restart } from "./api";
import { Chart, seriesChart } from "./Chart";
import { invoke } from "@tauri-apps/api/core";
import { nativeDesktop } from "./api";
import { defaultSettings, normalizeSettings } from "./shared/settings";
import { useLiveStats } from "./shared/live";
import BarSettingsPanel from "./settings/BarSettingsPanel";
import FocusPanel from "./FocusPanel";

const navigation = [
  ["/", "Overview", Grid2X2],
  ["/activity", "Activity", Activity],
  ["/movement", "Movement", MousePointer2],
  ["/clicks", "Clicks", Crosshair],
  ["/heatmap", "Heatmap", Grid2X2],
  ["/sessions", "Sessions", Clock3],
  ["/focus", "Focus", Crosshair],
  ["/history", "History", History],
  ["/insights", "Insights", Lightbulb],
  ["/settings", "Settings", Settings2],
] as const;
const readRoute = () =>
  window.location.hash.slice(1) ||
  (["/", "/index.html"].includes(window.location.pathname)
    ? "/"
    : window.location.pathname);
const emptyDashboard: Dashboard = {
  daily: [],
  timeline: [],
  sessions: [],
  heatmap: [],
  monitors: [],
  baseline: emptyStats(),
  baseline_days: 0,
  weekly: emptyStats(),
  weekly_range: dateRange("7 days"),
  records: [],
  deviations: [],
};
const time = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const prettyDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
function Panel({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{detail ?? "Selected period"}</span>
    </div>
  );
}

export default function App() {
  const { live, unavailable } = useLiveStats();
  const [route, setRoute] = useState(readRoute);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLElement>(null);
  const [preset, setPreset] = useState("Today");
  const [range, setRange] = useState<Range>(dateRange("Today"));
  const [monitor, setMonitor] = useState("all");
  const [data, setData] = useState<Dashboard>(emptyDashboard);
  const [settings, setSettings] = useState(defaultSettings);
  const [draft, setDraft] = useState(defaultSettings);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(desktop);
  const [busy, setBusy] = useState(false);
  const [pauseMenu, setPauseMenu] = useState(false);
  const [toast, setToast] = useState("");
  const [deleteMode, setDeleteMode] = useState<"range" | "all" | null>(null);
  const [heatMode, setHeatMode] = useState("dwell");
  const [clickFilter, setClickFilter] = useState("all");
  const [hasSettings, setHasSettings] = useState(false);
  const refreshSequence = useRef(0);
  const settingsLoaded = useRef(false);
  const onboardingOpen =
    desktop && hasSettings && !settings.onboarding_complete;
  useEffect(() => {
    if (!onboardingOpen && !deleteMode) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(
      onboardingOpen ? ".onboarding" : '[role="alertdialog"]',
    );
    const items = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)",
        ) ?? [],
      );
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && deleteMode && !busy) setDeleteMode(null);
      if (event.key !== "Tab") return;
      const controls = items();
      const first = controls[0],
        last = controls.at(-1);
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [onboardingOpen, deleteMode, busy]);
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const sequence = ++refreshSequence.current;
    try {
      const [next, state] = await Promise.all([
        call<Dashboard>("GetRange", {
          range,
          monitor: monitor === "all" ? null : Number(monitor),
        }),
        call<Status>("GetStatus"),
      ]);
      if (!settingsLoaded.current) {
        const s = normalizeSettings(await call<Settings>("GetSettings"));
        setSettings(s);
        setDraft(s);
        setHasSettings(true);
        settingsLoaded.current = true;
      }
      if (sequence === refreshSequence.current) {
        setData(next);
        setStatus(state);
        setError("");
      }
    } catch (e) {
      if (sequence === refreshSequence.current) {
        setError(String(e));
        setStatus(null);
      }
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [range, monitor]);
  useEffect(() => {
    if (!live) return;
    setStatus((previous) => ({
      ...previous,
      tracking: live.tracking,
      paused: live.paused,
      incognito: live.incognito,
      paused_until: live.paused_until,
      idle: !live.session,
      current_session: live.session,
      dropped_moves: previous?.dropped_moves ?? 0,
      queue_overflows: previous?.queue_overflows ?? 0,
      storage_error: live.storage_error,
    }));
    const next = normalizeSettings(live.settings);
    if (JSON.stringify(next) !== JSON.stringify(settings)) {
      const changed = Object.fromEntries(
        Object.entries(next).filter(
          ([key, value]) =>
            key !== "trace_bar" &&
            JSON.stringify(value) !==
              JSON.stringify(settings[key as keyof Settings]),
        ),
      );
      const barChanged = Object.fromEntries(
        Object.entries(next.trace_bar).filter(
          ([key, value]) =>
            value !== settings.trace_bar[key as keyof typeof next.trace_bar],
        ),
      );
      setSettings(next);
      setDraft((previous) => ({
        ...previous,
        ...changed,
        trace_bar: { ...previous.trace_bar, ...barChanged },
      }));
    }
  }, [live]);
  useEffect(() => {
    if (unavailable) setError(unavailable);
  }, [unavailable]);
  useEffect(() => {
    const fn = () => {
      setRoute(readRoute());
      setMobileMenuOpen(false);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    setLoading(desktop);
    if (desktop) setData(emptyDashboard);
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
      if (preset !== "Custom") {
        const current = dateRange(preset);
        setRange((previous) =>
          previous.start === current.start && previous.end === current.end
            ? previous
            : current,
        );
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh, preset]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--accent",
      settings.accent_color,
    );
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);
  const stats = useMemo(() => sumStats(data.daily.map((d) => d.stats)), [data]);
  const distanceDpi = data.monitors.length === 1 ? data.monitors[0].dpi_x : 96;
  const distance = (px: number) =>
    convertPixelDistance(px, settings.distance_unit, distanceDpi).value;
  const formatDistance = (px: number) => {
    const converted = pixelDistance(px, settings.distance_unit, distanceDpi);
    return `${converted.value} ${converted.unit}`;
  };
  const dist = pixelDistance(
    stats.distance_px,
    settings.distance_unit,
    distanceDpi,
  );
  const distanceSubtitle = `${dist.estimate ? "Estimated screen distance" : "Cursor distance"} (${dist.unit})`;
  async function chooseDistanceUnit(unit: string) {
    const next = { ...settings, distance_unit: unit };
    await perform(async () => {
      if (desktop) await call("SaveSettings", { settings: next });
      setSettings(next);
      setDraft((previous) => ({ ...previous, distance_unit: unit }));
    });
  }
  const routeInfo = navigation.find((n) => n[0] === route);
  const title = routeInfo?.[1] ?? "Page not found";
  const knownRoute = !!routeInfo;
  useEffect(() => {
    document.title = `${title} | Trace`;
  }, [title]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = menuPanel.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled)",
        ) ?? [],
      );
    panel?.querySelector<HTMLButtonElement>(".mobile-menu-close")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const viewport = window.matchMedia("(max-width: 850px)");
    const onResize = () => {
      if (!viewport.matches) setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    viewport.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      viewport.removeEventListener("change", onResize);
      if (menuTrigger.current?.getClientRects().length)
        menuTrigger.current.focus();
    };
  }, [mobileMenuOpen]);
  const countDays =
    Math.round(
      (Date.parse(`${range.end}T12:00:00Z`) -
        Date.parse(`${range.start}T12:00:00Z`)) /
        86400000,
    ) + 1;
  const totalTime = stats.active_ms + stats.idle_ms;
  const activePercent = totalTime
    ? Math.round((stats.active_ms / totalTime) * 100)
    : 0;
  async function perform(task: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await task();
      if (success) setToast(success);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings(onboarding = false) {
    const next = {
      ...draft,
      onboarding_complete: onboarding || draft.onboarding_complete,
    };
    await perform(async () => {
      await call("SaveSettings", { settings: next });
      setSettings(next);
      setDraft(next);
    }, "Preferences saved.");
  }
  function choosePreset(value: string) {
    setPreset(value);
    if (value !== "Custom") setRange(dateRange(value));
  }
  function updateRange(key: keyof Range, value: string) {
    const next = { ...range, [key]: value };
    if (next.start && next.end && next.start <= next.end) setRange(next);
  }
  async function doExport(format: string) {
    await perform(async () => {
      const path = await exportData(format, range);
      if (path) setToast(`Export saved to ${path}`);
    });
  }
  const activityLabels = data.timeline.map((t) =>
    countDays === 1
      ? time(t.timestamp)
      : `${prettyDate(localDate(new Date(t.timestamp)))} ${time(t.timestamp)}`,
  );
  const density = data.timeline.map(
    (t) => t.stats.movement_samples + clicks(t.stats) + t.stats.scroll_events,
  );
  const activityChart = (
    <Chart
      option={seriesChart(activityLabels, density)}
      label={`Hourly interaction counts: ${number(density.reduce((a, b) => a + b, 0))} sampled movements, clicks and scroll events`}
    />
  );
  const heatValue = (h: Dashboard["heatmap"][number]) =>
    heatMode === "dwell"
      ? h.dwell_ms / 1000
      : heatMode === "scroll"
        ? h.scroll_count
        : heatMode === "drag"
          ? h.drag_count
          : clickFilter === "left"
            ? h.left_clicks
            : clickFilter === "right"
              ? h.right_clicks
              : h.left_clicks + h.right_clicks + h.middle_clicks;
  const combinedHeat = new Map<string, [number, number, number]>();
  for (const h of data.heatmap) {
    const key = `${h.grid_x},${h.grid_y}`;
    const old = combinedHeat.get(key);
    combinedHeat.set(key, [h.grid_x, h.grid_y, (old?.[2] ?? 0) + heatValue(h)]);
  }
  const heatPoints = [...combinedHeat.values()];
  const heatMax = Math.max(1, ...heatPoints.map((h) => h[2]));
  const heatOption = {
    grid: { left: 4, right: 4, top: 4, bottom: 4 },
    tooltip: {
      formatter: (p: { value: number[] }) =>
        `Region ${p.value[0] + 1}, ${p.value[1] + 1}: ${number(p.value[2], 1)} ${heatMode === "dwell" ? "active seconds" : "events"}`,
    },
    xAxis: {
      type: "category",
      data: Array.from({ length: 64 }, (_, i) => i),
      show: false,
    },
    yAxis: {
      type: "category",
      data: Array.from({ length: 36 }, (_, i) => i),
      inverse: true,
      show: false,
    },
    visualMap: {
      min: 0,
      max: heatMax,
      show: false,
      inRange: { color: ["#191e15", "#344a22", "#6b963e", "#b6e77d"] },
    },
    series: [
      {
        type: "heatmap",
        data: heatPoints,
        emphasis: { itemStyle: { borderColor: "#edf3e7", borderWidth: 1 } },
      },
    ],
  };
  const heatmap = (
    <div className="heatmap-frame">
      {heatPoints.length ? (
        <Chart
          option={heatOption}
          label={`64 by 36 screen grid showing ${heatMode} interaction intensity`}
          height={230}
        />
      ) : (
        <div className="heatmap-empty">
          <MousePointer2 size={28} />
          <span>Your interaction map starts here</span>
          <small>Heatmap cells appear as you use your pointer.</small>
        </div>
      )}
    </div>
  );
  const efficiency = stats.efficiency_count
    ? `${number((stats.efficiency_sum / stats.efficiency_count) * 100, 1)}%`
    : "—";
  const speed = `${formatDistance(stats.speed_count ? stats.speed_sum / stats.speed_count : 0)}/s`;
  const hasData = data.daily.length > 0;
  const comparison = (
    label: string,
    value: number,
    base: number,
    format: (n: number) => string,
  ) => {
    const change = baselineChange(value / countDays, base, data.baseline_days);
    return (
      <div className="comparison-row" key={label}>
        <span>{label}</span>
        <strong>{format(value / countDays)}</strong>
        <span>
          {data.baseline_days ? format(base / data.baseline_days) : "—"}
        </span>
        <span className={change === null ? "muted" : "accent"}>
          {change === null
            ? "—"
            : `${change >= 0 ? "+" : ""}${number(change, 1)}%`}
        </span>
      </div>
    );
  };
  const overview = (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-line" />
            YOUR DAY, IN MOTION
          </div>
          <h2>
            <span>{dist.value}</span> <em>{dist.unit}</em>
          </h2>
          <p>
            Cursor travelled {preset === "Today" ? "today" : "in this period"}
          </p>
          <span className="hero-note">
            {dist.estimate
              ? "Approximate screen distance · estimated from display DPI"
              : "Every little movement adds up."}
          </span>
        </div>
        <div className="orbit-art" aria-hidden="true">
          <div className="orbit o1" />
          <div className="orbit o2" />
          <div className="orbit o3" />
          <div className="orbit-dot" />
          <MousePointer2 size={48} />
          <span>
            Small moves.
            <br />A bigger picture.
          </span>
        </div>
      </section>
      <div className="stats-grid">
        <Stat
          label="Total clicks"
          value={number(clicks(stats))}
          detail={`${number(stats.double_clicks)} double clicks`}
          icon={<Crosshair size={16} />}
        />
        <Stat
          label="Scroll steps"
          value={number(scrollSteps(stats), 1)}
          detail="Native wheel delta ÷ 120"
          icon={<Footprints size={16} />}
        />
        <Stat
          label="Active time"
          value={duration(stats.active_ms)}
          detail={`${activePercent}% of tracked time`}
          icon={<Activity size={16} />}
        />
        <Stat
          label="Sessions"
          value={number(stats.session_count)}
          detail={`${duration(stats.active_ms / Math.max(1, stats.session_count))} average duration`}
          icon={<Clock3 size={16} />}
        />
      </div>
      <div className="two-column">
        <Panel
          title="Activity rhythm"
          subtitle="Sampled movement, clicks and scrolling by hour"
          action={<span className="legend-dot">Interactions</span>}
        >
          {activityChart}
          {!hasData && (
            <p className="chart-empty-note">
              No activity in this date range yet.
            </p>
          )}
        </Panel>
        <Panel
          title="Your screen, mapped"
          subtitle="Active cursor dwell · normalized across displays"
          action={
            <a className="icon-link" href="#/heatmap" aria-label="Open heatmap">
              <ArrowUpRight size={17} />
            </a>
          }
        >
          {heatmap}
          <div className="heat-legend">
            <span>Less activity</span>
            <i />
            <span>More activity</span>
          </div>
        </Panel>
      </div>
      <div className="two-column">
        <Panel
          title="In perspective"
          subtitle={`Daily average vs the prior 30 days · ${data.baseline_days} recorded days`}
        >
          <div className="comparison-row comparison-header">
            <span>Metric</span>
            <span>This period / day</span>
            <span>Baseline / day</span>
            <span>Change</span>
          </div>
          {comparison("Clicks", clicks(stats), clicks(data.baseline), number)}
          {comparison(
            "Cursor distance",
            stats.distance_px,
            data.baseline.distance_px,
            formatDistance,
          )}
          {comparison(
            "Active time",
            stats.active_ms,
            data.baseline.active_ms,
            duration,
          )}
          {comparison(
            "Scroll steps",
            scrollSteps(stats),
            scrollSteps(data.baseline),
            (n) => number(n, 1),
          )}
          {comparison(
            "Sessions",
            stats.session_count,
            data.baseline.session_count,
            (n) => number(n, 1),
          )}
          {data.baseline_days < 14 && (
            <p className="footnote">
              Percentage comparisons unlock after 14 recorded days.
            </p>
          )}
        </Panel>
        <Panel title="Right now" subtitle="The current desktop session">
          <div className="current-session">
            <span className={`status-dot ${status?.tracking ? "" : "off"}`} />
            <div>
              <strong>
                {status?.tracking
                  ? status.idle
                    ? "Waiting for your next move"
                    : "Tracking your interaction"
                  : "Tracking is paused"}
              </strong>
              <p>
                {status?.current_session
                  ? `Started at ${time(status.current_session.start_ts)}`
                  : desktop
                    ? "A session begins with your next pointer interaction."
                    : "Open Trace on Windows to start collecting."}
              </p>
            </div>
          </div>
          <div className="session-metrics">
            <div>
              <strong>
                {duration(status?.current_session?.stats.active_ms ?? 0)}
              </strong>
              <span>Active time</span>
            </div>
            <div>
              <strong>
                {number(
                  status?.current_session
                    ? clicks(status.current_session.stats)
                    : 0,
                )}
              </strong>
              <span>Clicks</span>
            </div>
          </div>
          <div className="overview-efficiency">
            <span>Path efficiency</span>
            <strong>{efficiency}</strong>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={18} />
            <span>Just your interaction. Always on your device.</span>
          </div>
        </Panel>
      </div>
    </>
  );
  const sessions = (
    <Panel
      title="Interaction sessions"
      subtitle="A session starts when you return and ends at your idle threshold."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Start</th>
              <th>End</th>
              <th>Active time</th>
              <th>Clicks</th>
              <th>Distance</th>
              <th>Scroll steps</th>
              <th>Avg speed</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {prettyDate(localDate(new Date(s.start_ts)))} ·{" "}
                  {time(s.start_ts)}
                </td>
                <td>
                  {s.end_ts ? (
                    time(s.end_ts)
                  ) : (
                    <span className="accent">In progress</span>
                  )}
                </td>
                <td>{duration(s.stats.active_ms)}</td>
                <td>{number(clicks(s.stats))}</td>
                <td>{formatDistance(s.stats.distance_px)}</td>
                <td>{number(scrollSteps(s.stats), 1)}</td>
                <td>
                  {formatDistance(
                    s.stats.speed_sum / Math.max(1, s.stats.speed_count),
                  )}
                  /s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.sessions.length && (
          <Empty
            icon={<Clock3 />}
            title="Room for your first session"
            text="Start tracking and interact with your pointer. Sessions will appear here."
          />
        )}
      </div>
    </Panel>
  );
  const history = (
    <>
      <Panel title="Your interaction over time" subtitle={distanceSubtitle}>
        <Chart
          option={seriesChart(
            data.daily.map((d) => prettyDate(d.date)),
            data.daily.map((d) => distance(d.stats.distance_px)),
            "line",
          )}
          label={`Daily cursor distance trend in ${dist.unit}`}
        />
      </Panel>
      <Panel
        title="Daily history"
        subtitle="A local record of your interaction"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Distance</th>
                <th>Clicks</th>
                <th>Active</th>
                <th>Idle</th>
                <th>Sessions</th>
                <th>Scroll steps</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.date}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setPreset("Custom");
                        setRange({ start: d.date, end: d.date });
                        window.location.hash = "/";
                      }}
                    >
                      {prettyDate(d.date)}
                    </button>
                  </td>
                  <td>{formatDistance(d.stats.distance_px)}</td>
                  <td>{number(clicks(d.stats))}</td>
                  <td>{duration(d.stats.active_ms)}</td>
                  <td>{duration(d.stats.idle_ms)}</td>
                  <td>{number(d.stats.session_count)}</td>
                  <td>{number(scrollSteps(d.stats), 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!hasData && (
            <Empty
              icon={<CalendarDays />}
              title="Your history is still unwritten"
              text="Select another range, or let Trace quietly collect your interaction."
            />
          )}
        </div>
      </Panel>
    </>
  );
  const bestDay = [...data.daily].sort(
    (a, b) => b.stats.active_ms - a.stats.active_ms,
  )[0];
  const bestHour = [...data.timeline].sort(
    (a, b) =>
      clicks(b.stats) +
      b.stats.movement_samples +
      b.stats.scroll_events -
      (clicks(a.stats) + a.stats.movement_samples + a.stats.scroll_events),
  )[0];
  const insights = (
    <>
      <div className="insight-intro">
        <Lightbulb size={25} />
        <div>
          <h2>A little perspective on your patterns.</h2>
          <p>
            Descriptive observations about interaction. Your activity isn’t a
            productivity score.
          </p>
        </div>
      </div>
      <div className="two-column">
        <Panel
          title="Your period, wrapped"
          subtitle={`${prettyDate(range.start)} – ${prettyDate(range.end)}`}
        >
          <div className="wrapped-value">
            {dist.value}
            <span> {dist.unit}</span>
          </div>
          <p className="muted">
            of cursor travel{dist.estimate ? " (estimated)" : ""}
          </p>
          <div className="wrapped-stats">
            <span>
              <strong>{number(clicks(stats))}</strong> clicks
            </span>
            <span>
              <strong>{duration(stats.active_ms)}</strong> active
            </span>
            <span>
              <strong>{number(scrollSteps(stats), 1)}</strong> scroll steps
            </span>
          </div>
          {bestDay && (
            <p>
              {prettyDate(bestDay.date)} had the most active pointer time in
              this period.
            </p>
          )}
        </Panel>
        <Panel
          title="Patterns worth noticing"
          subtitle="Based on your selected period"
        >
          <ul className="insight-list">
            <li>
              <Clock3 size={18} />
              <span>
                {stats.session_count
                  ? `Your average interaction session contributed ${duration(stats.active_ms / stats.session_count)} of active time.`
                  : "Your first sessions will reveal your typical interaction duration."}
              </span>
            </li>
            <li>
              <Activity size={18} />
              <span>
                {bestHour
                  ? `The busiest sampled hour began at ${time(bestHour.timestamp)} on ${prettyDate(localDate(new Date(bestHour.timestamp)))}.`
                  : "Activity patterns appear once you have collected a little data."}
              </span>
            </li>
            <li>
              <Gauge size={18} />
              <span>
                {stats.efficiency_count
                  ? `Your path efficiency averaged ${efficiency} across ${number(stats.efficiency_count)} qualifying click-to-click paths.`
                  : "Efficiency is measured for click-to-click paths of at least 20 pixels."}
              </span>
            </li>
          </ul>
        </Panel>
      </div>
      <Panel title="Personal baseline" subtitle="Rolling 30-day comparison">
        <p>
          {data.baseline_days >= 14
            ? `Your baseline includes ${data.baseline_days} recorded days preceding this period. Your mean daily click count is ${number(clicks(data.baseline) / data.baseline_days)}.`
            : `You have ${data.baseline_days} recorded baseline days. At least 14 days are needed for a meaningful percentage comparison.`}
        </p>
        <p className="footnote">
          Activity varies naturally. Trace does not infer focus, distraction,
          health, or fatigue.
        </p>
      </Panel>
    </>
  );
  const settingsScreen = (
    <div className="settings-layout">
      <Panel title="Collection" subtitle="You decide when Trace runs.">
        <Toggle
          title="Enable interaction tracking"
          text="Collect mouse and touchpad interaction on this device."
          value={draft.tracking_enabled}
          change={(v) => setDraft({ ...draft, tracking_enabled: v })}
        />
        <Toggle
          title="Launch at Windows login"
          text="Start the lightweight collector for your Windows user."
          value={draft.launch_at_login}
          change={(v) => setDraft({ ...draft, launch_at_login: v })}
        />
        <label className="setting-row">
          <span>
            <strong>Idle threshold</strong>
            <small>End the session after pointer inactivity.</small>
          </span>
          <select
            value={draft.idle_threshold_seconds / 60}
            onChange={(e) =>
              setDraft({
                ...draft,
                idle_threshold_seconds: Number(e.target.value) * 60,
              })
            }
          >
            {Array.from({ length: 30 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1} min
              </option>
            ))}
          </select>
        </label>
        <div className="setting-row">
          <span>
            <strong>Application analytics</strong>
            <small>
              Future feature. Process names are not collected in this release.
            </small>
          </span>
          <span className="tag">Not enabled</span>
        </div>
      </Panel>
      <BarSettingsPanel
        value={draft.trace_bar}
        onChange={(trace_bar) =>
          setDraft((previous) => ({ ...previous, trace_bar }))
        }
      />
      <Panel
        title="Display & retention"
        subtitle="Raw pixel distance is always preserved."
      >
        <label className="setting-row">
          <span>
            <strong>Distance unit</strong>
            <small>
              Physical units are approximate screen-distance estimates.
            </small>
          </span>
          <select
            aria-label="Preferred distance unit"
            value={draft.distance_unit}
            onChange={(e) =>
              setDraft({ ...draft, distance_unit: e.target.value })
            }
          >
            {distanceUnits.map(({ unit, label }) => (
              <option key={unit} value={unit}>
                {label}
                {unit === "px" ? "" : " (estimate)"}
              </option>
            ))}
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>Theme</strong>
          </span>
          <select
            value={draft.theme}
            onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>Accent</strong>
          </span>
          <input
            type="color"
            value={draft.accent_color}
            onChange={(e) =>
              setDraft({ ...draft, accent_color: e.target.value })
            }
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Detailed minute data</strong>
            <small>
              Hourly, daily and heatmap aggregates are kept indefinitely.
            </small>
          </span>
          <select
            value={draft.minute_retention_days}
            onChange={(e) =>
              setDraft({
                ...draft,
                minute_retention_days: Number(e.target.value),
              })
            }
          >
            {[7, 14, 30].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </select>
        </label>
        <label className="setting-row">
          <span>
            <strong>Raw clicks & drags</strong>
            <small>Raw movement is never stored.</small>
          </span>
          <select
            value={draft.raw_retention_hours}
            onChange={(e) =>
              setDraft({
                ...draft,
                raw_retention_hours: Number(e.target.value),
              })
            }
          >
            {[1, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                {n} hours
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || !desktop}
          onClick={() => void saveSettings()}
        >
          Save preferences
        </button>
      </Panel>
      <Panel
        title="Your data, your control"
        subtitle="Export a copy or permanently remove your local history."
      >
        <div className="data-actions">
          <div>
            <h3>Export this date range</h3>
            <p>
              {range.start} through {range.end}.{" "}
              {localBrowser
                ? "Files download through your browser."
                : "Choose a local folder."}
            </p>
          </div>
          <button
            disabled={busy || !desktop}
            onClick={() => void doExport("csv")}
          >
            Export CSV
          </button>
          <button
            disabled={busy || !desktop}
            onClick={() => void doExport("json")}
          >
            Export JSON
          </button>
        </div>
        <div className="data-actions">
          <div>
            <h3>Delete today</h3>
            <p>Remove the current local day’s collected telemetry.</p>
          </div>
          <button
            className="danger"
            disabled={busy || !desktop}
            onClick={() => {
              setPreset("Today");
              setRange(dateRange("Today"));
              setDeleteMode("range");
            }}
          >
            Delete today
          </button>
        </div>
        <div className="data-actions">
          <div>
            <h3>Delete selected range</h3>
            <p>
              Remove telemetry for {range.start} through {range.end}.
            </p>
          </div>
          <button
            className="danger"
            disabled={busy || !desktop}
            onClick={() => setDeleteMode("range")}
          >
            <Trash2 size={15} />
            Delete range
          </button>
        </div>
        <div className="data-actions">
          <div>
            <h3>Delete all collected data</h3>
            <p>Your preferences will be kept. This cannot be undone.</p>
          </div>
          <button
            className="danger"
            disabled={busy || !desktop}
            onClick={() => setDeleteMode("all")}
          >
            Delete everything
          </button>
        </div>
      </Panel>
      <Panel
        title="Privacy by design"
        subtitle="Interaction telemetry. No personal content."
      >
        <div className="privacy-copy">
          <ShieldCheck size={30} />
          <p>
            Trace stores pointer aggregates in your Windows app-data folder. It
            does not capture keyboard input, passwords, screenshots, clipboard
            contents, browser URLs, messages, or document contents. There are no
            cloud accounts or remote analytics.{" "}
            {localBrowser
              ? "This development dashboard connects to the collector through a loopback-only local server."
              : "The desktop app has no network listener."}{" "}
            Data leaves your device only when you export it.
          </p>
        </div>
        <p className="footnote">
          Closing this dashboard leaves the collector running. Use “Stop Trace
          completely” in the tray menu to stop collection.
        </p>
      </Panel>
    </div>
  );
  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        ref={menuPanel}
        className={`sidebar ${mobileMenuOpen ? "mobile-menu-open" : ""}`}
        role={mobileMenuOpen ? "dialog" : undefined}
        aria-modal={mobileMenuOpen ? true : undefined}
        aria-label={mobileMenuOpen ? "Workspace navigation" : undefined}
      >
        <button
          className="mobile-menu-close icon-button"
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        >
          <X size={20} />
        </button>
        <a
          href="#/"
          className="brand"
          aria-label="Trace overview"
          onClick={() => setMobileMenuOpen(false)}
        >
          <span className="brand-mark">
            <MousePointer2 size={21} />
          </span>
          trace<span className="brand-version">LOCAL</span>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(([path, label, Icon]) => (
            <a
              key={path}
              href={`#${path}`}
              aria-current={route === path ? "page" : undefined}
              onClick={() => setMobileMenuOpen(false)}
              className={route === path ? "selected" : ""}
            >
              <Icon size={17} />
              {label}
              {route === path && <span className="nav-indicator" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <ShieldCheck size={16} />
            <span>Private by default</span>
          </div>
          <p>
            On your device.
            <br />
            Under your control.
          </p>
          <span className="version">
            Trace v0.1.0 <PanelLeftClose size={14} />
          </span>
        </div>
      </aside>
      <div className="main" inert={mobileMenuOpen}>
        <header className="topbar">
          <button
            ref={menuTrigger}
            className="mobile-menu-button"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={18} />
            Menu
          </button>
          <span className="breadcrumb">
            Workspace <span>/</span> <strong>{title}</strong>
          </span>
          <div className="top-actions">
            <button
              className="compact"
              disabled={!nativeDesktop || !settings.trace_bar.enabled}
              onClick={() =>
                void invoke("show_trace_bar").catch((e) => setError(String(e)))
              }
            >
              Trace Bar
            </button>
            <button
              className="compact"
              disabled={busy || !desktop || !status}
              onClick={() =>
                void perform(() =>
                  call("SetIncognito", { enabled: !status?.incognito }),
                )
              }
            >
              {status?.incognito ? "Leave incognito" : "Incognito"}
            </button>
            <span className="tracking-label">
              <i className={`status-dot ${status?.tracking ? "" : "off"}`} />
              {!desktop
                ? "Browser preview"
                : !status
                  ? loading
                    ? "Connecting collector"
                    : "Collector disconnected"
                  : status?.incognito
                    ? "Incognito"
                    : status?.tracking
                      ? "Tracking on"
                      : status?.paused
                        ? "Paused"
                        : "Tracking off"}
            </span>
            <div className="pause-wrap">
              <button
                className="compact"
                disabled={
                  busy || !desktop || (!status?.tracking && !status?.paused)
                }
                onClick={() =>
                  status?.paused
                    ? void perform(() => call("Resume"))
                    : setPauseMenu(!pauseMenu)
                }
              >
                {status?.paused ? (
                  <Play size={14} />
                ) : (
                  <CirclePause size={14} />
                )}{" "}
                {status?.paused ? "Resume" : "Pause"}
                <ChevronDown size={12} />
              </button>
              {pauseMenu && (
                <div className="dropdown">
                  {[
                    ["15 minutes", 900],
                    ["30 minutes", 1800],
                    ["1 hour", 3600],
                    ["Until resumed", null],
                  ].map(([label, seconds]) => (
                    <button
                      key={String(label)}
                      onClick={() => {
                        setPauseMenu(false);
                        void perform(() =>
                          call("Pause", { duration_seconds: seconds }),
                        );
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">PERSONAL INTERACTION ANALYTICS</div>
              <h1>{title}</h1>
              <p>
                {route === "/"
                  ? "A quiet record of how you move through your day."
                  : route === "/settings"
                    ? "Make Trace work the way you do."
                    : "Find the patterns in your everyday interaction."}
              </p>
            </div>
            {knownRoute && (
              <div className="range-controls">
                <label className="distance-unit-control">
                  <span>Distance unit</span>
                  <select
                    aria-label="Distance unit"
                    title="Choose distance and speed units"
                    value={settings.distance_unit}
                    disabled={busy || (desktop && !hasSettings)}
                    onChange={(e) => void chooseDistanceUnit(e.target.value)}
                  >
                    {distanceUnits.map(({ unit, label }) => (
                      <option key={unit} value={unit}>
                        {label} ({unit})
                      </option>
                    ))}
                  </select>
                </label>
                <CalendarDays size={15} />
                <select
                  aria-label="Date range"
                  value={preset}
                  onChange={(e) => choosePreset(e.target.value)}
                >
                  {["Today", "Yesterday", "7 days", "30 days", "Custom"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
                <button
                  className="icon-button"
                  title="Refresh data"
                  disabled={loading || busy}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={15} className={loading ? "spinning" : ""} />
                </button>
                <button
                  disabled={busy || !desktop}
                  onClick={() => void doExport("json")}
                >
                  <ArrowDownToLine size={14} />
                  Export
                </button>
              </div>
            )}
          </div>
          {knownRoute && dist.estimate && route !== "/settings" && (
            <p className="footnote">
              Physical units estimate cursor travel across the screen using{" "}
              {number(distanceDpi)} DPI
              {data.monitors.length === 1
                ? "."
                : " as a fallback for unavailable or mixed display DPI."}{" "}
              They do not measure mouse travel on your desk.
            </p>
          )}
          {knownRoute && preset === "Custom" && (
            <div className="custom-range">
              <label>
                From{" "}
                <input
                  type="date"
                  value={range.start}
                  max={range.end}
                  onChange={(e) => updateRange("start", e.target.value)}
                />
              </label>
              <span>→</span>
              <label>
                To{" "}
                <input
                  type="date"
                  value={range.end}
                  min={range.start}
                  onChange={(e) => updateRange("end", e.target.value)}
                />
              </label>
            </div>
          )}
          {!desktop && (
            <div className="notice">
              <ShieldCheck size={16} />
              <span>
                Desktop preview · Real interaction data is collected only by the
                Windows app. For live tracking locally, run npm run dev on
                Windows and open http://127.0.0.1:1420, or launch
                dist/trace.exe.
              </span>
            </div>
          )}
          {localBrowser && status && (
            <div className="notice">
              <ShieldCheck size={16} />
              <span>
                Local Windows collector connected through this development
                server. Data stays on your device.
              </span>
            </div>
          )}
          {desktop &&
            hasSettings &&
            settings.onboarding_complete &&
            !settings.tracking_enabled && (
              <div className="notice">
                <CirclePause size={16} />
                <span>
                  Tracking is disabled. Enable interaction tracking in{" "}
                  <a href="#/settings">Settings</a> and save preferences to
                  start recording.
                </span>
              </div>
            )}
          {error && (
            <div className="error-notice" role="alert">
              <span>{error}</span>
              {desktop && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await restart();
                      const s = normalizeSettings(
                        await call<Settings>("GetSettings"),
                      );
                      setSettings(s);
                      setDraft(s);
                      setHasSettings(true);
                      settingsLoaded.current = true;
                    })
                  }
                >
                  Reconnect
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {status?.storage_error && (
            <div className="error-notice" role="alert">
              Local storage needs attention: {status.storage_error}. Pending
              data is being retained.
            </div>
          )}
          {!!(status?.queue_overflows || status?.dropped_moves) && (
            <div className="notice">
              High input load: {number(status?.dropped_moves ?? 0)} movement
              events coalesced or dropped;{" "}
              {number(status?.queue_overflows ?? 0)} queue overflows. Collected
              distance may be incomplete.
            </div>
          )}
          {!knownRoute ? (
            <Panel
              title="We couldn't find that page"
              subtitle="The link may be incorrect or the page may have moved."
            >
              <p>Your saved activity is still available.</p>
              <a className="return-overview" href="#/">
                Back to Overview <ArrowUpRight size={16} />
              </a>
            </Panel>
          ) : loading && !hasData ? (
            <div className="loading">
              <LoaderCircle className="spinning" />
              Reading your local history…
            </div>
          ) : route === "/settings" ? (
            settingsScreen
          ) : route === "/focus" ? (
            <FocusPanel
              range={range}
              live={live}
              settings={settings}
              dpi={distanceDpi}
            />
          ) : route === "/sessions" ? (
            sessions
          ) : route === "/history" ? (
            history
          ) : route === "/insights" ? (
            <>
              {insights}
              <AdvancedInsights data={data} settings={settings} />
            </>
          ) : route === "/heatmap" ? (
            <>
              <div className="heat-controls">
                <div className="segmented">
                  {["dwell", "clicks", "scroll", "drag"].map((mode) => (
                    <button
                      className={heatMode === mode ? "active" : ""}
                      key={mode}
                      onClick={() => setHeatMode(mode)}
                    >
                      {mode === "dwell"
                        ? "Cursor dwell"
                        : mode[0].toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Monitor"
                  value={monitor}
                  onChange={(e) => setMonitor(e.target.value)}
                >
                  <option value="all">All monitors · overlaid</option>
                  {data.monitors.map((m) => (
                    <option value={m.monitor_id} key={m.monitor_id}>
                      {m.device_name} · {m.width} × {m.height}
                    </option>
                  ))}
                </select>
                {heatMode === "clicks" && (
                  <select
                    aria-label="Click type"
                    value={clickFilter}
                    onChange={(e) => setClickFilter(e.target.value)}
                  >
                    <option value="all">All clicks</option>
                    <option value="left">Left clicks</option>
                    <option value="right">Right clicks</option>
                  </select>
                )}
              </div>
              <Panel
                title="Your interaction footprint"
                subtitle="64 × 36 grid · coordinates normalized within each display"
              >
                {heatmap}
                <div className="heat-legend">
                  <span>Less activity</span>
                  <i />
                  <span>More activity</span>
                </div>
                <p className="footnote">
                  Dwell measures active seconds at the cursor location. No
                  screen images are captured. Selecting all monitors overlays
                  their normalized grids.
                </p>
              </Panel>
            </>
          ) : route === "/activity" ? (
            <>
              <div className="stats-grid">
                <Stat
                  label="Active time"
                  value={duration(stats.active_ms)}
                  icon={<Activity size={16} />}
                />
                <Stat
                  label="Idle time"
                  value={duration(stats.idle_ms)}
                  icon={<Clock3 size={16} />}
                />
                <Stat
                  label="Active share"
                  value={`${activePercent}%`}
                  icon={<Gauge size={16} />}
                />
                <Stat
                  label="Sessions"
                  value={number(stats.session_count)}
                  icon={<Clock3 size={16} />}
                />
              </div>
              <Panel
                title="Activity by hour"
                subtitle="Raw activity density, without a productivity score"
              >
                {activityChart}
              </Panel>
              {sessions}
            </>
          ) : route === "/movement" ? (
            <>
              <div className="stats-grid">
                <Stat
                  label="Cursor distance"
                  value={`${dist.value} ${dist.unit}`}
                  detail={
                    dist.estimate
                      ? "Estimated physical screen distance"
                      : "Physical screen coordinates"
                  }
                  icon={<MousePointer2 size={16} />}
                />
                <Stat
                  label="Average speed"
                  value={speed}
                  detail="Mean of sampled segment speeds"
                  icon={<Gauge size={16} />}
                />
                <Stat
                  label="95th percentile"
                  value={`${formatDistance(percentile(stats, 0.95))}/s`}
                  detail="Approximate histogram percentile"
                  icon={<Activity size={16} />}
                />
                <Stat
                  label="Path efficiency"
                  value={efficiency}
                  detail={`${number(stats.efficiency_count)} qualifying paths`}
                  icon={<Footprints size={16} />}
                />
              </div>
              <div className="two-column">
                <Panel title="Daily distance" subtitle={distanceSubtitle}>
                  <Chart
                    option={seriesChart(
                      data.daily.map((d) => prettyDate(d.date)),
                      data.daily.map((d) => distance(d.stats.distance_px)),
                      "line",
                    )}
                    label={`Daily cursor distance in ${dist.unit}`}
                  />
                </Panel>
                <Panel
                  title="Speed distribution"
                  subtitle={`Logarithmic speed buckets (${dist.unit}/s)`}
                >
                  <Chart
                    option={seriesChart(
                      stats.speed_histogram.map(
                        (_, i) =>
                          pixelDistance(
                            2 ** (i / 2) - 1,
                            settings.distance_unit,
                            distanceDpi,
                          ).value,
                      ),
                      stats.speed_histogram,
                    )}
                    label="Histogram of sampled cursor speed"
                  />
                </Panel>
              </div>
              <Panel title="Movement details">
                <div className="detail-grid">
                  <span>
                    Maximum speed
                    <strong>{formatDistance(stats.max_speed)}/s</strong>
                  </span>
                  <span>
                    50th percentile
                    <strong>{formatDistance(percentile(stats, 0.5))}/s</strong>
                  </span>
                  <span>
                    Direction changes
                    <strong>{number(stats.direction_changes)}</strong>
                  </span>
                  <span>
                    Drags<strong>{number(stats.drag_count)}</strong>
                  </span>
                  <span>
                    Drag distance
                    <strong>{formatDistance(stats.drag_distance_px)}</strong>
                  </span>
                  <span>
                    Drag duration
                    <strong>{duration(stats.drag_duration_ms)}</strong>
                  </span>
                </div>
              </Panel>
            </>
          ) : route === "/clicks" ? (
            <>
              <div className="stats-grid">
                <Stat
                  label="Total clicks"
                  value={number(clicks(stats))}
                  icon={<Crosshair size={16} />}
                />
                <Stat
                  label="Left clicks"
                  value={number(stats.left_clicks)}
                  icon={<MousePointer2 size={16} />}
                />
                <Stat
                  label="Right clicks"
                  value={number(stats.right_clicks)}
                  icon={<MousePointer2 size={16} />}
                />
                <Stat
                  label="Double clicks"
                  value={number(stats.double_clicks)}
                  detail="Pairs within Windows double-click settings"
                  icon={<Crosshair size={16} />}
                />
              </div>
              <div className="two-column">
                <Panel
                  title="Click breakdown"
                  subtitle={`${number(stats.middle_clicks)} middle clicks · ${number(clicks(stats) / (stats.active_ms / 60000 || 1), 1)} clicks per active minute`}
                >
                  <Chart
                    label="Left, right and middle click breakdown"
                    option={{
                      tooltip: { trigger: "item" },
                      legend: { bottom: 0, textStyle: { color: "#939b8b" } },
                      series: [
                        {
                          type: "pie",
                          radius: ["48%", "72%"],
                          center: ["50%", "44%"],
                          label: { show: false },
                          data: [
                            {
                              name: "Left",
                              value: stats.left_clicks,
                              itemStyle: { color: "#b6e77d" },
                            },
                            {
                              name: "Right",
                              value: stats.right_clicks,
                              itemStyle: { color: "#6f8853" },
                            },
                            {
                              name: "Middle",
                              value: stats.middle_clicks,
                              itemStyle: { color: "#3a4830" },
                            },
                          ],
                        },
                      ],
                    }}
                  />
                </Panel>
                <Panel
                  title="Click heatmap"
                  subtitle="Areas receiving completed clicks"
                >
                  <button
                    className="text-button"
                    onClick={() => {
                      setHeatMode("clicks");
                      window.location.hash = "/heatmap";
                    }}
                  >
                    Explore click locations <ArrowUpRight size={14} />
                  </button>
                  <p className="footnote">
                    Click positions are stored as normalized cells. A
                    held-button movement over 6 pixels counts as a drag, rather
                    than a click.
                  </p>
                  <div className="large-metric">
                    {number(clicks(stats))}
                    <span>completed clicks</span>
                  </div>
                </Panel>
              </div>
              <Panel title="Click history">
                <Chart
                  option={seriesChart(
                    data.daily.map((d) => prettyDate(d.date)),
                    data.daily.map((d) => clicks(d.stats)),
                  )}
                  label="Daily completed clicks"
                />
              </Panel>
            </>
          ) : (
            overview
          )}
          <footer>
            <span>
              <ShieldCheck size={13} />
              Stored locally. Nothing shared.
            </span>
            <span>
              {prettyDate(range.start)}
              {range.start !== range.end
                ? ` – ${prettyDate(range.end)}`
                : ""} · {number(data.daily.length)} recorded{" "}
              {data.daily.length === 1 ? "day" : "days"}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {deleteMode && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <Trash2 size={27} className="danger-text" />
            <h2 id="delete-title">
              {deleteMode === "all"
                ? "Delete all interaction data?"
                : "Delete this date range?"}
            </h2>
            <p>
              {deleteMode === "all"
                ? "All collected telemetry will be permanently removed. Your preferences will remain."
                : `Telemetry from ${range.start} through ${range.end} will be permanently removed. Sessions crossing these dates retain their activity outside the deleted range.`}{" "}
              This cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                autoFocus
                disabled={busy}
                onClick={() => setDeleteMode(null)}
              >
                Keep my data
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await call(
                      deleteMode === "all" ? "DeleteAll" : "DeleteRange",
                      deleteMode === "all" ? undefined : { range },
                    );
                    setDeleteMode(null);
                  }, "Collected data deleted.")
                }
              >
                Delete permanently
              </button>
            </div>
          </section>
        </div>
      )}
      {onboardingOpen && (
        <div className="modal-backdrop">
          <section
            className="modal onboarding"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
          >
            <span className="brand-mark">
              <MousePointer2 size={28} />
            </span>
            <div className="eyebrow">WELCOME TO TRACE</div>
            <h2 id="welcome-title">
              Your interaction.
              <br />A new perspective.
            </h2>
            <p>
              Free to use. No account, subscription or trial. Your mouse and
              touchpad activity stays on this PC; Trace never records typed text
              or screen content.
            </p>
            <Toggle
              title="Enable interaction tracking"
              text="You can pause or delete your data at any time."
              value={draft.tracking_enabled}
              change={(v) => setDraft({ ...draft, tracking_enabled: v })}
            />
            <Toggle
              title="Start with Windows"
              text="Optional. Start collecting after login, even with the dashboard closed."
              value={draft.launch_at_login}
              change={(v) => setDraft({ ...draft, launch_at_login: v })}
            />
            <p className="footnote">
              History is saved in %LOCALAPPDATA%\Trace. Closing the dashboard
              keeps tracking running; use the system tray to pause or quit. You
              can export or delete history in Settings.
            </p>
            <button
              className="primary full"
              disabled={busy}
              onClick={() => void saveSettings(true)}
            >
              {busy
                ? "Saving…"
                : draft.tracking_enabled
                  ? "Start tracking"
                  : "Explore without tracking"}
              <ArrowUpRight size={16} />
            </button>
            {error && (
              <p className="danger-text" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Toggle({
  title,
  text,
  value,
  change,
}: {
  title: string;
  text: string;
  value: boolean;
  change: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <button
        className={`toggle ${value ? "on" : ""}`}
        role="switch"
        aria-checked={value}
        aria-label={title}
        onClick={() => change(!value)}
      >
        <i />
      </button>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function AdvancedInsights({
  data,
  settings,
}: {
  data: Dashboard;
  settings: Settings;
}) {
  const dist = pixelDistance(
    data.weekly.distance_px,
    settings.distance_unit,
    data.monitors.length === 1 ? data.monitors[0].dpi_x : 96,
  );
  return (
    <>
      <Panel
        title="Your week, wrapped"
        subtitle={`${prettyDate(data.weekly_range.start)} – ${prettyDate(data.weekly_range.end)} · seven calendar days`}
      >
        <div className="wrapped-stats">
          <span>
            <strong>
              {dist.value} {dist.unit}
            </strong>
            cursor travel{dist.estimate ? " · estimated" : ""}
          </span>
          <span>
            <strong>{number(clicks(data.weekly))}</strong>clicks
          </span>
          <span>
            <strong>{duration(data.weekly.active_ms)}</strong>active time
          </span>
          <span>
            <strong>{number(scrollSteps(data.weekly), 1)}</strong>scroll steps
          </span>
        </div>
      </Panel>
      <Panel
        title="Personal records"
        subtitle="Across your retained local history"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Record</th>
                <th>Value</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((record) => (
                <tr key={record.metric}>
                  <td>{record.metric}</td>
                  <td>
                    {record.unit === "seconds"
                      ? duration(record.value * 1000)
                      : record.unit === "px"
                        ? (() => {
                            const converted = pixelDistance(
                              record.value,
                              settings.distance_unit,
                              data.monitors.length === 1
                                ? data.monitors[0].dpi_x
                                : 96,
                            );
                            return `${converted.value} ${converted.unit}`;
                          })()
                        : `${number(record.value, 1)} ${record.unit}`}
                  </td>
                  <td>{prettyDate(record.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.records.length && (
            <p className="footnote">
              Your first recorded days will establish your personal records.
            </p>
          )}
        </div>
      </Panel>
      <Panel
        title="Statistical deviations"
        subtitle="Compared with the variation in your recorded baseline days"
      >
        {data.deviations.length ? (
          data.deviations.map((d) => (
            <p key={d.metric} className="footnote">
              The selected period’s daily mean for {d.metric.toLowerCase()} is{" "}
              {number(Math.abs(d.standard_deviations), 1)} standard deviations{" "}
              {d.standard_deviations > 0 ? "above" : "below"} your baseline
              mean.
            </p>
          ))
        ) : (
          <p className="footnote">
            {data.baseline_days < 14
              ? "Collect at least 14 baseline days to see statistical deviations."
              : "No metrics differ from the baseline by two or more standard deviations."}
          </p>
        )}
        <p className="footnote">
          Daily means include all calendar days in the selected range. Baselines
          use recorded days. These observations do not establish a cause or a
          productivity judgment.
        </p>
      </Panel>
    </>
  );
}
