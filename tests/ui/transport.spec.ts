import { test, expect } from "@playwright/test";
import { emptyStats } from "../../apps/desktop/src/metrics";
test("collector startup failure recovers and tracking consent is saved", async ({
  page,
}) => {
  await page.addInitScript(
    ({ stats }) => {
      Object.defineProperty(window, "isTauri", { value: true });
      let attempts = 0;
      let settings = {
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
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke: async (
            method: string,
            input?: {
              request: {
                command: string;
                args: {
                  settings: typeof settings;
                  range: { start: string; end: string };
                };
              };
            },
          ) => {
            if (method === "restart_collector") {
              if (++attempts === 1) throw new Error("Collector startup failed");
              return null;
            }
            const request = input!.request;
            if (request.command === "GetSettings") return settings;
            if (request.command === "SaveSettings") {
              settings = request.args.settings;
              return null;
            }
            if (request.command === "GetStatus")
              return {
                tracking: settings.tracking_enabled,
                idle: true,
                paused: false,
                paused_until: null,
                dropped_moves: 0,
                queue_overflows: 0,
                storage_error: null,
                current_session: null,
              };
            if (request.command === "GetRange")
              return {
                daily: [],
                timeline: [],
                sessions: [],
                heatmap: [],
                monitors: [],
                baseline: stats,
                baseline_days: 0,
                weekly: stats,
                weekly_range: request.args.range,
                records: [],
                deviations: [],
              };
            throw new Error("Unexpected command " + request.command);
          },
        },
      });
    },
    { stats: emptyStats() },
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "Collector startup failed",
  );
  const welcome = page.getByRole("dialog");
  await expect(welcome).toBeVisible({ timeout: 10000 });
  await welcome
    .getByRole("switch", { name: "Enable interaction tracking" })
    .click();
  await welcome
    .getByRole("button", { name: "Start tracking", exact: true })
    .click();
  await expect(welcome).not.toBeVisible();
  await expect(page.getByText("Tracking on", { exact: true })).toBeVisible();
});
test("slow old range responses cannot replace a newer range, and pause resumes through IPC", async ({
  page,
}) => {
  await page.addInitScript(
    ({ stats }) => {
      Object.defineProperty(window, "isTauri", { value: true });
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const settings = {
        launch_at_login: false,
        tracking_enabled: true,
        idle_threshold_seconds: 300,
        raw_retention_hours: 24,
        minute_retention_days: 30,
        theme: "dark",
        accent_color: "#b6e77d",
        distance_unit: "px",
        application_tracking_enabled: false,
        onboarding_complete: true,
      };
      let paused = false;
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke: async (
            method: string,
            input: {
              request: {
                command: string;
                args?: { range?: { start: string; end: string } };
              };
            },
          ) => {
            if (method === "restart_collector") return null;
            if (method !== "collector")
              throw new Error("Unexpected transport method");
            const request = input.request;
            if (request.command === "GetSettings") return settings;
            if (request.command === "Pause") {
              paused = true;
              return null;
            }
            if (request.command === "Resume") {
              paused = false;
              return null;
            }
            if (request.command === "GetStatus")
              return {
                tracking: !paused,
                idle: true,
                paused,
                paused_until: null,
                dropped_moves: 0,
                queue_overflows: 0,
                storage_error: null,
                current_session: null,
              };
            if (request.command === "GetRange") {
              const range = request.args!.range!;
              const first = range.start === date;
              await new Promise((resolve) =>
                setTimeout(resolve, first ? 1200 : 30),
              );
              return {
                daily: [
                  {
                    date: range.start,
                    stats: { ...stats, left_clicks: first ? 11 : 99 },
                  },
                ],
                timeline: [],
                sessions: [],
                heatmap: [],
                monitors: [],
                baseline: stats,
                baseline_days: 0,
                weekly: stats,
                weekly_range: range,
                records: [],
                deviations: [],
              };
            }
            throw new Error("Unexpected command " + request.command);
          },
        },
      });
    },
    { stats: emptyStats() },
  );
  await page.goto("/");
  await page.getByLabel("Date range").selectOption("Yesterday");
  await expect(
    page.locator(".stat").filter({ hasText: "Total clicks" }).locator("strong"),
  ).toHaveText("99");
  // Wait beyond the intentionally delayed initial response to catch a stale overwrite.
  await page.waitForTimeout(1400);
  await expect(
    page.locator(".stat").filter({ hasText: "Total clicks" }).locator("strong"),
  ).toHaveText("99");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "15 minutes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText("Tracking on", { exact: true })).toBeVisible();
});
