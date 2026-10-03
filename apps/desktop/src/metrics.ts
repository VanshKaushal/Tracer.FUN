import type { Stats, Range } from "./types";
export function emptyStats(): Stats {
  return {
    active_ms: 0,
    idle_ms: 0,
    distance_px: 0,
    movement_samples: 0,
    left_clicks: 0,
    right_clicks: 0,
    middle_clicks: 0,
    double_clicks: 0,
    drag_count: 0,
    drag_distance_px: 0,
    drag_duration_ms: 0,
    scroll_delta: 0,
    horizontal_scroll_delta: 0,
    scroll_abs_delta: 0,
    scroll_events: 0,
    scroll_bursts: 0,
    direction_changes: 0,
    session_count: 0,
    speed_sum: 0,
    speed_count: 0,
    max_speed: 0,
    speed_histogram: Array(32).fill(0),
    efficiency_sum: 0,
    efficiency_count: 0,
  };
}
export function sumStats(stats: Stats[]): Stats {
  const result = emptyStats();
  for (const s of stats) {
    for (const key of Object.keys(result) as (keyof Stats)[]) {
      if (key === "speed_histogram")
        result.speed_histogram = result.speed_histogram.map(
          (n, i) => n + (s.speed_histogram[i] ?? 0),
        );
      else if (key === "max_speed")
        result.max_speed = Math.max(result.max_speed, s.max_speed);
      else result[key] += s[key];
    }
  }
  return result;
}
export const clicks = (s: Stats) =>
  s.left_clicks + s.right_clicks + s.middle_clicks;
export const scrollSteps = (s: Stats) => s.scroll_abs_delta / 120;
export const number = (value: number, decimals = 0) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals }).format(
    value,
  );
export function duration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return `${Math.floor(ms / 1000)}s`;
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export const distanceUnits = [
  { unit: "px", label: "Pixels", meters: 0 },
  { unit: "mm", label: "Millimeters", meters: 0.001 },
  { unit: "cm", label: "Centimeters", meters: 0.01 },
  { unit: "m", label: "Meters", meters: 1 },
  { unit: "km", label: "Kilometers", meters: 1000 },
  { unit: "in", label: "Inches", meters: 0.0254 },
  { unit: "ft", label: "Feet", meters: 0.3048 },
  { unit: "yd", label: "Yards", meters: 0.9144 },
  { unit: "mi", label: "Miles", meters: 1609.344 },
] as const;
export function convertPixelDistance(px: number, unit: string, dpi = 96) {
  const scale =
    distanceUnits.find((entry) => entry.unit === unit) ?? distanceUnits[0];
  return {
    value:
      scale.unit === "px"
        ? px
        : ((px / (Number.isFinite(dpi) && dpi > 0 ? dpi : 96)) * 0.0254) /
          scale.meters,
    unit: scale.unit,
    estimate: scale.unit !== "px",
  };
}
export function pixelDistance(px: number, unit: string, dpi = 96) {
  const result = convertPixelDistance(px, unit, dpi);
  // Keep small distances readable even when users choose kilometers or miles.
  const decimals =
    result.unit === "px"
      ? 0
      : Math.abs(result.value) > 0 && Math.abs(result.value) < 0.01
        ? 6
        : 2;
  return { ...result, value: number(result.value, decimals) };
}
export function percentile(s: Stats, p: number) {
  const target = Math.ceil(s.speed_count * p);
  if (!target) return 0;
  let count = 0;
  for (let i = 0; i < s.speed_histogram.length; i++) {
    count += s.speed_histogram[i];
    if (count >= target) return Math.min(s.max_speed, 2 ** ((i + 1) / 2) - 1);
  }
  return s.max_speed;
}
export const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function dateRange(preset: string, today = new Date()): Range {
  const end = new Date(today);
  const start = new Date(today);
  if (preset === "Yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "7 days") start.setDate(start.getDate() - 6);
  else if (preset === "30 days") start.setDate(start.getDate() - 29);
  return { start: localDate(start), end: localDate(end) };
}
export function baselineChange(
  current: number,
  baseline: number,
  days: number,
) {
  if (days < 14 || baseline === 0) return null;
  return (current / (baseline / days) - 1) * 100;
}
