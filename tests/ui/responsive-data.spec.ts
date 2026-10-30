import { test, expect } from "@playwright/test";
import { emptyStats } from "../../apps/desktop/src/metrics";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";

test("populated analytics fit narrow screens and tables scroll within their panels", async ({
  page,
}) => {
  await page.addInitScript(
    ({ stats, defaults }) => {
      Object.defineProperty(window, "isTauri", { value: true });
      const totals = {
        ...stats,
        distance_px: 9876543210,
        left_clicks: 1234567890,
        active_ms: 123456789000,
        idle_ms: 1000000,
        session_count: 42,
        movement_samples: 15000,
        speed_count: 500,
        speed_sum: 12345000,
        max_speed: 987654,
        scroll_abs_delta: 987654321,
        efficiency_count: 1,
        efficiency_sum: 0.6,
      };
      const session = {
        id: 1,
        start_ts: Date.now() - 3600000,
        end_ts: null,
        stats: totals,
      };
      const settings = {
        ...defaults,
        tracking_enabled: true,
        onboarding_complete: true,
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          transformCallback: () => 1,
          invoke: async (method: string, input: any) => {
            if (method !== "collector") return 1;
            const { command, args } = input.request;
            if (command === "GetSettings") return settings;
            if (command === "GetStatus")
              return {
                tracking: true,
                paused: false,
                incognito: false,
                idle: false,
                paused_until: null,
                dropped_moves: 0,
                queue_overflows: 0,
                storage_error: null,
                current_session: session,
              };
            if (command === "GetLiveStats")
              return {
                timestamp_ms: Date.now(),
                tracking: true,
                paused: false,
                incognito: false,
                suspended: false,
                session,
                today: totals,
                focus: null,
                completed_focus: null,
                settings,
                distance_dpi: 96,
                insight: null,
                storage_error: null,
              };
            if (command === "GetFocusSessions")
              return [
                {
                  ...session,
                  end_ts: Date.now(),
                  updated_ts: Date.now(),
                  context_switches: null,
                },
              ];
            if (command === "GetRange")
              return {
                daily: [{ date: args.range.start, stats: totals }],
                timeline: [{ timestamp: session.start_ts, stats: totals }],
                sessions: [session],
                monitors: [
                  {
                    monitor_id: 1,
                    device_name:
                      "A long monitor name for small-screen layout validation",
                    width: 1920,
                    height: 1080,
                    dpi_x: 96,
                    dpi_y: 96,
                  },
                ],
                heatmap: [
                  {
                    monitor_id: 1,
                    grid_x: 1,
                    grid_y: 1,
                    dwell_ms: 1000,
                    left_clicks: 10,
                    right_clicks: 0,
                    middle_clicks: 0,
                    scroll_count: 1,
                    drag_count: 0,
                  },
                ],
                baseline: totals,
                baseline_days: 30,
                weekly: totals,
                weekly_range: args.range,
                records: [],
                deviations: [],
              };
            throw new Error(`Unexpected request ${command}`);
          },
        },
      });
    },
    { stats: emptyStats(), defaults: defaultSettings },
  );
  for (const width of [320, 430, 768]) {
    await page.setViewportSize({ width, height: 568 });
    for (const route of [
      "/",
      "/activity",
      "/movement",
      "/clicks",
      "/heatmap",
      "/sessions",
      "/focus",
      "/history",
      "/insights",
      "/settings",
    ]) {
      await page.goto("/#" + route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Reading your local history…")).toHaveCount(
        0,
      );
      const layout = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        width: innerWidth,
      }));
      expect(layout.document, `${route} at ${width}px`).toBeLessThanOrEqual(
        layout.width,
      );
      if (width === 320 && route === "/")
        await page.screenshot({
          path: "test-results/mobile-populated-overview.png",
          fullPage: true,
        });
      if (["/sessions", "/history", "/focus"].includes(route)) {
        await expect(
          page.locator(".table-wrap tbody tr").first(),
        ).toBeVisible();
        const panel = await page.locator(".table-wrap").first().boundingBox();
        expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
      }
    }
  }
});
