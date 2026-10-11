import { useEffect, useState } from "react";
import type { FocusSession, LiveStats, Range, Settings } from "./types";
import { call, desktop } from "./api";
import { clicks, duration, pixelDistance, number } from "./metrics";
import { timerText, useClock } from "./shared/live";
export default function FocusPanel({
  range,
  live,
  settings,
  dpi,
}: {
  range: Range;
  live: LiveStats | null;
  settings: Settings;
  dpi: number;
}) {
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const now = useClock(!!live?.focus);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void call<FocusSession[]>("GetFocusSessions", { range })
      .then((s) => {
        if (!cancelled) setSessions(s);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [range, revision, live?.focus?.id, live?.completed_focus?.id]);
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await call(live?.focus ? "EndFocus" : "StartFocus");
      setRevision((v) => v + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const distance = (px: number) => {
    const d = pixelDistance(px, settings.distance_unit, dpi);
    return `${d.value} ${d.unit}`;
  };
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>
              {live?.focus ? "Your focus session" : "Make room for focus"}
            </h2>
            <p>
              Mark a stretch of interaction and review its totals afterward.
            </p>
          </div>
          <button
            className="primary"
            disabled={
              !desktop ||
              busy ||
              (!live?.focus && !live?.tracking) ||
              (!live?.focus && !settings.trace_bar.focus_mode)
            }
            onClick={() => void toggle()}
          >
            {live?.focus ? "End focus session" : "Start focus session"}
          </button>
        </div>
        <div className="large-metric">
          {timerText(live?.focus ? now - live.focus.start_ts : 0)}
          <span>
            {live?.focus
              ? `${number(clicks(live.focus.stats))} clicks · ${distance(live.focus.stats.distance_px)} cursor travel · ${duration(live.focus.stats.active_ms)} active`
              : "Enable tracking to start. Pause excludes activity; incognito ends the focus session."}
          </span>
        </div>
        {error && (
          <p role="alert" className="error-notice">
            {error}
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Focus history</h2>
            <p>Sessions in the selected date range</p>
          </div>
        </div>
        {sessions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Active</th>
                  <th>Clicks</th>
                  <th>Cursor distance</th>
                  <th>Scroll steps</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.start_ts).toLocaleString()}</td>
                    <td>
                      {s.end_ts
                        ? duration(s.end_ts - s.start_ts)
                        : "In progress"}
                    </td>
                    <td>{duration(s.stats.active_ms)}</td>
                    <td>{number(clicks(s.stats))}</td>
                    <td>{distance(s.stats.distance_px)}</td>
                    <td>{number(s.stats.scroll_abs_delta / 120)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>Your focus history starts here</h3>
            <p>Start a session from this page or the Trace Bar.</p>
          </div>
        )}
      </section>
    </>
  );
}
