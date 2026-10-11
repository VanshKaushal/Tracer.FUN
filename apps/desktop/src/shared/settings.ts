import type { BarSettings, Settings } from "../types";
export const defaultBarSettings: BarSettings = {
  enabled: true,
  launch_with_trace: true,
  edge: "right",
  monitor: "",
  offset: 0.46,
  auto_collapse: true,
  hide_fullscreen: true,
  show_during_focus_fullscreen: false,
  notifications_fullscreen: false,
  show_live_timer: true,
  show_clicks: true,
  show_distance: true,
  hover_timer: true,
  hover_clicks: true,
  hover_distance: true,
  hover_scroll: false,
  hover_active: false,
  notifications: true,
  personal_records: true,
  focus_mode: true,
};
export const defaultSettings: Settings = {
  launch_at_login: false,
  tracking_enabled: false,
  idle_threshold_seconds: 300,
  raw_retention_hours: 24,
  minute_retention_days: 30,
  theme: "dark",
  accent_color: "#b6e77d",
  distance_unit: "px",
  application_tracking_enabled: false,
  onboarding_complete: false,
  trace_bar: defaultBarSettings,
};
export function normalizeSettings(settings: Settings): Settings {
  return {
    ...defaultSettings,
    ...settings,
    trace_bar: { ...defaultBarSettings, ...settings.trace_bar },
  };
}
