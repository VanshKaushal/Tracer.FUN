import type { BarSettings } from "../types";
import { nativeDesktop } from "../api";
import { invoke } from "@tauri-apps/api/core";
const toggles: [keyof BarSettings, string][] = [
  ["enabled", "Show Trace Bar"],
  ["launch_with_trace", "Launch with Trace"],
  ["auto_collapse", "Auto collapse"],
  ["hide_fullscreen", "Hide over fullscreen apps"],
  ["show_during_focus_fullscreen", "Show during focus sessions in fullscreen"],
  ["notifications_fullscreen", "Show notifications in fullscreen"],
  ["show_live_timer", "Live session timer"],
  ["show_clicks", "Click count"],
  ["show_distance", "Cursor distance"],
  ["focus_mode", "Focus controls"],
  ["notifications", "Insights"],
  ["personal_records", "Personal records"],
];
const hoverToggles: [keyof BarSettings, string][] = [
  ["hover_timer", "Session timer on hover"],
  ["hover_clicks", "Click count on hover"],
  ["hover_distance", "Cursor distance on hover"],
  ["hover_scroll", "Scroll steps on hover"],
  ["hover_active", "Active time on hover"],
];
export default function BarSettingsPanel({
  value,
  onChange,
}: {
  value: BarSettings;
  onChange: (settings: BarSettings) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Trace Bar</h2>
          <p>
            Quick access at your screen edge. Tracking continues when the bar
            closes.
          </p>
        </div>
      </div>
      {toggles.map(([key, label]) => (
        <div className="setting-row" key={key}>
          <span>
            <strong>{label}</strong>
          </span>
          <button
            type="button"
            role="switch"
            aria-label={label}
            aria-checked={!!value[key]}
            className={`toggle ${value[key] ? "on" : ""}`}
            onClick={() => onChange({ ...value, [key]: !value[key] })}
          >
            <i />
          </button>
        </div>
      ))}
      <h3>Hover details</h3>
      <p className="footnote">
        Choose what appears when you hover. Click the bar for the full view.
      </p>
      {hoverToggles.map(([key, label]) => (
        <div className="setting-row" key={key}>
          <strong>{label}</strong>
          <button
            type="button"
            role="switch"
            aria-label={label}
            aria-checked={!!value[key]}
            className={`toggle ${value[key] ? "on" : ""}`}
            onClick={() => onChange({ ...value, [key]: !value[key] })}
          >
            <i />
          </button>
        </div>
      ))}
      <label className="setting-row">
        <span>
          <strong>Dock position</strong>
          <small>
            Drag the bar to transfer it to another monitor. Snap within 48
            pixels of an edge.
          </small>
        </span>
        <select
          aria-label="Trace Bar position"
          value={value.edge}
          onChange={(e) =>
            onChange({ ...value, edge: e.target.value as BarSettings["edge"] })
          }
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="bottom">Bottom</option>
        </select>
      </label>
      <p className="footnote">
        Hover reveals details immediately and tucks away when you leave.
        Expanded collapses after 5 seconds. Use Tab and Enter to operate the
        bar; Esc collapses it.
      </p>
      <button
        type="button"
        disabled={!nativeDesktop || !value.enabled}
        onClick={() => void invoke("show_trace_bar").catch(() => {})}
      >
        Open Trace Bar
      </button>
      <p className="footnote">Apply changes with Save preferences.</p>
    </section>
  );
}
