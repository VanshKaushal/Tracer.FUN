import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowUpRight,
  CirclePause,
  Crosshair,
  EyeOff,
  GripVertical,
  MousePointer2,
  Play,
  Settings2,
  X,
} from "lucide-react";
import { call, nativeDesktop, restart } from "../api";
import {
  clicks,
  duration,
  number,
  pixelDistance,
  scrollSteps,
} from "../metrics";
import { timerText, useClock, useLiveStats } from "../shared/live";
import { defaultSettings } from "../shared/settings";
import type { Insight } from "../types";
import { collapse, enqueueInsight, type BarMode } from "./store";

export default function TraceBar() {
  const { live, unavailable } = useLiveStats();
  const settings = live?.settings ?? defaultSettings;
  const bar = { ...defaultSettings.trace_bar, ...settings.trace_bar };
  const [hovered, setHovered] = useState(false);
  const [mode, setMode] = useState<BarMode>(() => {
    const initial = window.location.hash.slice(1);
    return initial === "expanded" ||
      initial === "compact" ||
      initial === "contextual"
      ? initial
      : "peek";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pauseMenu, setPauseMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [inbox, setInbox] = useState<Insight[]>([]);
  const [activity, setActivity] = useState(0);
  const seen = useRef(new Set<string>());
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const focus = live?.focus ?? null;
  const now = useClock(
    !!focus || (!!live?.session && (bar.show_live_timer || bar.hover_timer)),
  );
  const session = focus ?? live?.session;
  const elapsed = session
    ? Math.max(0, (session.end_ts ?? now) - session.start_ts)
    : 0;
  const card = inbox[0];
  const state = unavailable
    ? "Unavailable"
    : live?.incognito
      ? "Incognito"
      : live?.paused
        ? "Paused"
        : live?.tracking
          ? "Tracking"
          : nativeDesktop && !live
            ? "Connecting"
            : "Tracking off";
  const preview = !nativeDesktop;
  const distance = (px: number) => {
    const value = pixelDistance(px, settings.distance_unit, live?.distance_dpi);
    return `${value.value} ${value.unit}`;
  };
  const touch = () => setActivity((v) => v + 1);
  const hoverDetails = [
    bar.hover_timer && {
      label: focus ? "Focus" : "Session",
      value: duration(elapsed),
    },
    bar.hover_clicks && {
      label: "Clicks",
      value: number(live ? clicks(live.today) : 0),
    },
    bar.hover_distance && {
      label: "Cursor",
      value: distance(live?.today.distance_px ?? 0),
    },
    bar.hover_scroll && {
      label: "Scroll steps",
      value: number(live ? scrollSteps(live.today) : 0),
    },
    bar.hover_active && {
      label: "Active",
      value: duration(live?.today.active_ms ?? 0),
    },
  ].filter((detail): detail is { label: string; value: string } => !!detail);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInbox((queue) => queue.slice(1));
        setMode("compact");
        setPauseMenu(false);
        setActivity((value) => value + 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const open = (route = "/") =>
    nativeDesktop
      ? invoke("open_trace_dashboard", { route })
      : Promise.resolve(
          window.location.assign(`/${route === "/" ? "" : `#${route}`}`),
        );
  async function action(command: string, args?: unknown) {
    setBusy(true);
    setError("");
    touch();
    try {
      await call(command, args);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!nativeDesktop) return;
    void invoke("set_bar_mode", { mode, activate: false }).catch((e) =>
      setError(String(e)),
    );
  }, [
    mode,
    bar.edge,
    bar.hover_timer,
    bar.hover_clicks,
    bar.hover_distance,
    bar.hover_scroll,
    bar.hover_active,
  ]);
  useEffect(() => {
    if (mode === "peek" && focus) setMode("compact");
    if (
      !bar.auto_collapse ||
      dragging ||
      busy ||
      pauseMenu ||
      unavailable ||
      mode === "peek" ||
      (hovered && mode === "compact") ||
      card
    )
      return;
    const timer = setTimeout(
      () => setMode((previous) => collapse(previous, !!focus)),
      mode === "expanded" ? 5000 : 120,
    );
    return () => clearTimeout(timer);
  }, [
    mode,
    hovered,
    activity,
    bar.auto_collapse,
    dragging,
    busy,
    pauseMenu,
    unavailable,
    focus?.id,
    card?.id,
  ]);
  useEffect(() => {
    if (unavailable) setMode("contextual");
  }, [unavailable]);
  useEffect(() => {
    const insight = live?.insight;
    if (
      !insight ||
      seen.current.has(insight.id) ||
      (!bar.notifications && insight.priority > 2)
    )
      return;
    seen.current.add(insight.id);
    if (seen.current.size > 100)
      seen.current.delete(seen.current.values().next().value!);
    setInbox((queue) => enqueueInsight(queue, insight, Date.now()));
  }, [live?.insight, bar.notifications]);
  useEffect(() => {
    if (!card || unavailable) return;
    setMode("contextual");
    const timer = setTimeout(
      () => {
        setInbox((queue) => queue.filter((i) => i.id !== card.id));
        setMode("compact");
      },
      Math.max(0, card.expires_ts - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [card?.id, unavailable]);
  useEffect(() => {
    if (!nativeDesktop) return;
    let disposed = false;
    const cleanup: (() => void)[] = [];
    void listen("trace-bar-invoke", () => {
      setMode("expanded");
      touch();
    }).then((fn) => (disposed ? fn() : cleanup.push(fn)));
    void listen<string | null>("trace-bar-drag-ended", (e) => {
      setDragging(false);
      if (e.payload) setError(e.payload);
      touch();
    }).then((fn) => (disposed ? fn() : cleanup.push(fn)));
    return () => {
      disposed = true;
      cleanup.forEach((fn) => fn());
    };
  }, []);
  const dragProps = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      pointer.current = { x: e.screenX, y: e.screenY, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const start = pointer.current;
      if (
        !start ||
        start.moved ||
        Math.hypot(e.screenX - start.x, e.screenY - start.y) < 6
      )
        return;
      start.moved = true;
      if (nativeDesktop) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(true);
        void invoke("drag_trace_bar").catch((e) => {
          setError(String(e));
          setDragging(false);
        });
      }
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (pointer.current?.moved) {
        e.preventDefault();
        e.stopPropagation();
      } else {
        setMode("expanded");
        if (nativeDesktop)
          void invoke("set_bar_mode", {
            mode: "expanded",
            activate: true,
          }).catch((e) => setError(String(e)));
        touch();
      }
      pointer.current = null;
    },
  };
  function dismiss() {
    setInbox((queue) => queue.slice(1));
    setMode("compact");
    setPauseMenu(false);
    touch();
  }
  return (
    <section
      className={`trace-bar ${mode} ${bar.edge} ${live?.tracking && !unavailable ? "on" : "off"} ${preview ? "preview" : ""}`}
      style={
        {
          "--accent": settings.accent_color,
          "--hover-count": hoverDetails.length,
          "--hover-width": `${112 + 100 * hoverDetails.length}px`,
          "--hover-height": `${44 + 44 * Math.ceil(hoverDetails.length / 2)}px`,
        } as React.CSSProperties
      }
      aria-label="Trace Bar"
      onPointerEnter={() => {
        setHovered(true);
        if (mode === "peek" && !dragging) setMode("compact");
        touch();
      }}
      onPointerLeave={() => {
        setHovered(false);
        touch();
      }}
      onPointerMove={touch}
      onFocus={touch}
      onKeyDown={(e) => {
        touch();
      }}
    >
      {mode === "peek" ? (
        <button
          className="peek-control"
          aria-label="Expand Trace Bar"
          title={`Trace · ${state}`}
          {...dragProps}
          onPointerEnter={() => {
            if (!dragging) {
              setMode("compact");
              touch();
            }
          }}
        >
          <i className="state-dot" />
        </button>
      ) : mode === "compact" ? (
        <div className="compact-content">
          <button
            className="compact-control"
            aria-label="Expand Trace Bar"
            title={`Trace · ${state}`}
            {...dragProps}
          >
            <i className="state-dot" />
            <span className="hover-heading">{state}</span>
            <span className="hover-details">
              {hoverDetails.map(({ label, value }) => (
                <span className="hover-metric" key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </span>
              ))}
              {!hoverDetails.length && (
                <span className="hover-status">{state}</span>
              )}
            </span>
          </button>
          <div className="hover-actions">
            <button
              aria-label={live?.paused ? "Resume tracking" : "Pause tracking"}
              disabled={preview || busy || !live || live.incognito}
              onClick={() =>
                void action(
                  live?.paused ? "Resume" : "Pause",
                  live?.paused ? undefined : { duration_seconds: null },
                )
              }
            >
              {live?.paused ? <Play size={18} /> : <CirclePause size={18} />}
            </button>
            <button aria-label="Open dashboard" onClick={() => void open()}>
              <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <header>
            <button
              className="drag-handle"
              aria-label="Drag Trace Bar"
              {...dragProps}
            >
              <GripVertical size={14} />
              <b>TRACE</b>
            </button>
            <span className="tracking-state">
              <i className="state-dot" />
              {state}
            </span>
            <button aria-label="Collapse Trace Bar" onClick={dismiss}>
              <X size={14} />
            </button>
          </header>
          {preview && (
            <p className="preview-note">
              Desktop preview · Open the Windows app for live tracking.
            </p>
          )}
          {unavailable ? (
            <div className="insight-card" role="alert">
              <h2>Trace unavailable</h2>
              <p>Tracking stopped or the collector disconnected.</p>
              <button
                onClick={() => void restart().catch((e) => setError(String(e)))}
              >
                Restart Trace
              </button>
            </div>
          ) : mode === "contextual" && card ? (
            <div className="insight-card">
              <small>{card.title}</small>
              <h2>{card.message}</h2>
              {card.priority === 2 && live?.completed_focus && (
                <p>
                  {distance(live.completed_focus.stats.distance_px)} cursor
                  travel · {duration(live.completed_focus.stats.active_ms)}{" "}
                  active
                </p>
              )}
              <button
                onClick={() => {
                  void open(card.route);
                  dismiss();
                }}
              >
                View details <ArrowUpRight size={14} />
              </button>
              <button onClick={dismiss}>Dismiss</button>
            </div>
          ) : (
            <>
              <div className="session-timer">
                <strong>{timerText(elapsed)}</strong>
                <small>{focus ? "FOCUS SESSION" : "CURRENT SESSION"}</small>
              </div>
              <div className="bar-metrics">
                {bar.show_clicks && (
                  <div>
                    <strong>{number(live ? clicks(live.today) : 0)}</strong>
                    <small>CLICKS TODAY</small>
                  </div>
                )}
                {bar.show_distance && (
                  <div
                    title={
                      settings.distance_unit === "px"
                        ? "Cursor travel"
                        : "Estimated screen distance"
                    }
                  >
                    <strong>{distance(live?.today.distance_px ?? 0)}</strong>
                    <small>CURSOR TODAY</small>
                  </div>
                )}
                <div>
                  <strong>{number(live ? scrollSteps(live.today) : 0)}</strong>
                  <small>SCROLL STEPS</small>
                </div>
                <div>
                  <strong>{duration(live?.today.active_ms ?? 0)}</strong>
                  <small>ACTIVE TODAY</small>
                </div>
              </div>
              {live?.incognito && (
                <p className="privacy-note">
                  Events are ignored. Nothing is saved.
                </p>
              )}
              {pauseMenu ? (
                <div className="pause-options">
                  {[
                    ["15 min", 900],
                    ["30 min", 1800],
                    ["1 hour", 3600],
                    ["Until resumed", null],
                  ].map(([label, seconds]) => (
                    <button
                      key={label}
                      disabled={busy}
                      onClick={() => {
                        void action("Pause", { duration_seconds: seconds });
                        setPauseMenu(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bar-actions">
                  <button
                    aria-label={
                      live?.paused ? "Resume tracking" : "Pause tracking"
                    }
                    title={live?.paused ? "Resume tracking" : "Pause tracking"}
                    disabled={preview || busy || !live || live.incognito}
                    onClick={() =>
                      live?.paused ? void action("Resume") : setPauseMenu(true)
                    }
                  >
                    {live?.paused ? (
                      <Play size={18} />
                    ) : (
                      <CirclePause size={18} />
                    )}
                  </button>
                  {(bar.focus_mode || focus) && (
                    <button
                      aria-label={
                        focus ? "End focus session" : "Start focus session"
                      }
                      title={
                        focus ? "End focus session" : "Start focus session"
                      }
                      className={focus ? "selected" : ""}
                      disabled={preview || busy || (!focus && !live?.tracking)}
                      onClick={() =>
                        void action(focus ? "EndFocus" : "StartFocus")
                      }
                    >
                      <Crosshair size={18} />
                    </button>
                  )}
                  <button
                    aria-label={
                      live?.incognito ? "Leave incognito" : "Enter incognito"
                    }
                    title={
                      live?.incognito ? "Leave incognito" : "Enter incognito"
                    }
                    className={live?.incognito ? "selected" : ""}
                    disabled={preview || busy || !live}
                    onClick={() =>
                      void action("SetIncognito", { enabled: !live?.incognito })
                    }
                  >
                    <EyeOff size={18} />
                  </button>
                  <button
                    aria-label="Open dashboard"
                    title="Open dashboard"
                    onClick={() => void open()}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                  <button
                    aria-label="Open settings"
                    title="Open settings"
                    onClick={() => void open("/settings")}
                  >
                    <Settings2 size={18} />
                  </button>
                </div>
              )}
            </>
          )}
          {(error || live?.storage_error) && (
            <p className="bar-error" role="alert">
              {error || live?.storage_error}
            </p>
          )}
          <footer>
            <MousePointer2 size={12} />
            <span>Local only · Your interaction, your data</span>
            <button
              aria-label="Close Trace Bar"
              title="Close bar; keep tracking"
              onClick={() =>
                nativeDesktop ? void invoke("close_trace_bar") : setMode("peek")
              }
            >
              <X size={12} />
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
