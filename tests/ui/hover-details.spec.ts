import { test, expect } from "@playwright/test";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";
import { emptyStats } from "../../apps/desktop/src/metrics";

for (const edge of ["left", "right", "bottom"] as const) {
  test(`hover details fit ${edge} docking and collapse on leave`, async ({ page }) => {
    await page.setViewportSize(edge === "bottom" ? { width: 612, height: 64 } : { width: 240, height: 176 });
    await page.addInitScript(({ defaults, stats, edge }) => {
      Object.defineProperty(window, "isTauri", { value: true });
      Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
        transformCallback: () => 1,
        invoke: async (method: string) => method === "collector" ? {
          timestamp_ms: Date.now(), tracking: true, paused: false, incognito: false,
          suspended: false, session: null, focus: null, completed_focus: null,
          today: { ...stats, left_clicks: 1842, distance_px: 12345, active_ms: 3600000, scroll_abs_delta: 3600 },
          settings: { ...defaults, trace_bar: { ...defaults.trace_bar, edge, hover_scroll: true, hover_active: true } },
          distance_dpi: 96, insight: null, storage_error: null,
        } : 1,
      }});
    }, { defaults: defaultSettings, stats: emptyStats(), edge });
    await page.goto('/trace-bar.html');
    await page.getByRole('button', { name: 'Expand Trace Bar' }).hover();
    await expect(page.locator('.trace-bar')).toHaveClass(/compact/);
    await expect(page.locator('.hover-metric')).toHaveCount(5);
    await expect(page.locator('.hover-metric')).toContainText(['Session', 'Clicks', 'Cursor', 'Scroll steps', 'Active']);
    const boxes = await page.locator('.hover-metric').evaluateAll(nodes => nodes.map(n => {
      const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }));
    const viewport = page.viewportSize()!;
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `test-results/hover-${edge}.png` });
    await page.mouse.move(viewport.width + 100, viewport.height + 100);
    await expect(page.locator('.trace-bar')).toHaveClass(/peek/);
  });
}
