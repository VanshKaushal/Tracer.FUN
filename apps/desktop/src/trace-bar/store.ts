import type { Insight } from "../types";
export type BarMode = "peek" | "compact" | "expanded" | "contextual";
export function collapse(mode: BarMode, focus: boolean): BarMode {
  if (mode === "expanded" || mode === "contextual") return "compact";
  return focus ? "compact" : "peek";
}
export function enqueueInsight(
  queue: Insight[],
  insight: Insight,
  now: number,
) {
  const next = queue.filter((i) => i.expires_ts > now && i.id !== insight.id);
  if (insight.expires_ts > now) next.push(insight);
  return next.sort((a, b) => a.priority - b.priority).slice(0, 3);
}
