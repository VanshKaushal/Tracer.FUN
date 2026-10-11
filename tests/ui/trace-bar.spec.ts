import { test, expect } from "@playwright/test";
import { emptyStats } from "../../apps/desktop/src/metrics";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";
test("saving a distance preference is not overwritten by the previous live snapshot", async ({
  page,
}) => {
  await page.addInitScript(
    ({ stats, defaults }) => {
      Object.defineProperty(window, "isTauri", { value: true });
      let settings = {
        ...defaults,
        tracking_enabled: true,
        onboarding_complete: true,
      };
      const snapshot = {
        timestamp_ms: Date.now(),
        tracking: true,
        paused: false,
        paused_until: null,
        incognito: false,
        suspended: false,
        session: null,
        today: stats,
        focus: null,
        completed_focus: null,
        settings: structuredClone(settings),
        distance_dpi: 96,
        insight: null,
        storage_error: null,
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke: async (method: string, input: any) => {
            if (method === "restart_collector") return null;
            const request = input.request;
            if (request.command === "GetSettings") return settings;
            if (request.command === "GetLiveStats") return snapshot;
            if (request.command === "SaveSettings") {
              settings = request.args.settings;
              return null;
            }
            if (request.command === "GetStatus")
              return {
                tracking: true,
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
                daily: [
                  {
                    date: request.args.range.start,
                    stats: { ...stats, distance_px: 96 },
                  },
                ],
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
            throw new Error("Unexpected command");
          },
        },
      });
    },
    { stats: emptyStats(), defaults: defaultSettings },
  );
  await page.goto("/#/movement");
  const selector = page.getByLabel("Distance unit", { exact: true });
  await expect(selector).toBeEnabled();
  await selector.selectOption("cm");
  await expect(selector).toHaveValue("cm");
  await expect(
    page
      .locator(".stat")
      .filter({ hasText: "Cursor distance" })
      .locator("strong"),
  ).toHaveText("2.54 cm");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page.getByLabel("Preferred distance unit")).toHaveValue("cm");
});
test("bar shares tracking state, respects distance preference, and completes focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 280, height: 350 });
  await page.addInitScript(
    ({ stats, settings }) => {
      Object.defineProperty(window, "isTauri", { value: true });
      const callbacks = new Map<number, (event: unknown) => void>();
      const listeners = new Map<number, { event: string; handler: number }>();
      let next = 1;
      const state = {
        timestamp_ms: Date.now(),
        tracking: true,
        paused: false,
        paused_until: null as number | null,
        incognito: false,
        suspended: false,
        session: { id: 1, start_ts: Date.now() - 42000, end_ts: null, stats },
        today: { ...stats, left_clicks: 1842, distance_px: 96 },
        focus: null as any,
        completed_focus: null as any,
        settings: {
          ...settings,
          distance_unit: "cm",
          tracking_enabled: true,
          onboarding_complete: true,
        },
        distance_dpi: 96,
        insight: null as any,
        storage_error: null,
      };
      const emit = (event: string, payload: unknown) => {
        for (const [id, l] of listeners)
          if (l.event === event)
            callbacks.get(l.handler)?.({ event, id, payload });
      };
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        value: {
          unregisterListener: (_e: string, id: number) => listeners.delete(id),
        },
      });
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          transformCallback: (fn: (event: unknown) => void) => {
            const id = next++;
            callbacks.set(id, fn);
            return id;
          },
          invoke: async (method: string, input: any) => {
            if (method === "plugin:event|listen") {
              const id = next++;
              listeners.set(id, input);
              return id;
            }
            if (
              method === "plugin:event|unlisten" ||
              method === "restart_collector" ||
              method === "set_bar_mode" ||
              method === "open_trace_dashboard"
            )
              return null;
            if (method !== "collector")
              throw new Error(`Unexpected method ${method}`);
            const { command, args } = input.request;
            if (command === "GetLiveStats") return state;
            if (command === "Pause") {
              state.paused = true;
              state.tracking = false;
              state.paused_until = Date.now() + args.duration_seconds * 1000;
            } else if (command === "Resume") {
              state.paused = false;
              state.tracking = true;
            } else if (command === "SetIncognito") {
              state.incognito = args.enabled;
              state.tracking = !args.enabled;
              state.session = null as any;
            } else if (command === "StartFocus") {
              state.focus = {
                id: 1,
                start_ts: Date.now(),
                end_ts: null,
                updated_ts: Date.now(),
                stats: { ...stats, left_clicks: 12, distance_px: 96 },
                context_switches: null,
              };
              // Turning off future focus controls must still allow ending an active session.
              state.settings.trace_bar.focus_mode = false;
            } else if (command === "EndFocus") {
              state.completed_focus = { ...state.focus, end_ts: Date.now() };
              state.focus = null;
              state.insight = {
                id: "focus-1",
                priority: 2,
                title: "Focus completed",
                message: "12 clicks",
                route: "/focus",
                expires_ts: Date.now() + 15000,
              };
            } else throw new Error(`Unexpected command ${command}`);
            emit("trace-live", structuredClone(state));
            return null;
          },
        },
      });
    },
    { stats: emptyStats(), settings: defaultSettings },
  );
  await page.goto("/trace-bar.html");
  const expand = page.getByRole("button", { name: "Expand Trace Bar" });
  await expand.hover();
  await expect(page.locator('.hover-metric')).toHaveCount(3);
  await expect(page.locator('.hover-metric').filter({ hasText: 'Cursor' })).toContainText('2.54 cm');
  await expand.click();
  await expect(page.getByText("2.54 cm", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Pause tracking", exact: true })
    .click();
  await page.getByRole("button", { name: "15 min", exact: true }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enter incognito", exact: true })
    .click();
  await expect(
    page.getByText("Events are ignored. Nothing is saved."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Leave incognito", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start focus session", exact: true })
    .click();
  await expect(page.getByText("FOCUS SESSION", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/trace-bar-expanded.png" });
  await page
    .getByRole("button", { name: "End focus session", exact: true })
    .click();
  await expect(
    page.getByText("Focus completed", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Expand Trace Bar" }),
  ).toBeVisible();
});
test("bar preview is keyboard accessible and settings expose three dock edges", async ({
  page,
}) => {
  await page.goto("/trace-bar.html");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Start focus session" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Expand Trace Bar" }),
  ).toBeVisible();
  await page.goto("/trace-bar.html?invoked=1#expanded");
  await expect(
    page.getByRole("button", { name: "Collapse Trace Bar" }),
  ).toBeVisible();
  await page.goto("/#/settings");
  const edge = page.getByLabel("Trace Bar position");
  await expect(edge.locator("option")).toHaveText(["Left", "Right", "Bottom"]);
  await page.getByRole('switch', { name: 'Cursor distance on hover', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Cursor distance on hover', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.getByRole("switch", { name: "Hide over fullscreen apps" }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("switch", { name: "Show Trace Bar", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Show Trace Bar", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
});
