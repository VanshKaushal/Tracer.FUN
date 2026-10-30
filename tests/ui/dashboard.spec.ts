import { test, expect } from "@playwright/test";
test("dashboard explains the browser preview and navigates all analytics views", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Desktop preview · Real interaction data"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  for (const label of [
    "Activity",
    "Movement",
    "Clicks",
    "Heatmap",
    "Sessions",
    "Focus",
    "History",
    "Insights",
    "Settings",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${label} | Trace`);
  }
  await expect(page.getByText("No personal content.")).toBeVisible();
  expect(errors).toEqual([]);
});
test("date presets, custom ranges, and heatmap filters remain usable without telemetry", async ({
  page,
}) => {
  await page.goto("/#/heatmap");
  await page.getByLabel("Date range").selectOption("7 days");
  await page.getByLabel("Date range").selectOption("Custom");
  await expect(page.getByLabel("From", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Clicks", exact: true }).click();
  await page.getByLabel("Click type").selectOption("right");
  await expect(
    page.getByText("Your interaction map starts here"),
  ).toBeVisible();
});
test("compact layout keeps navigation and settings accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/#/settings");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Enable interaction tracking" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("distance selector updates movement, history, and settings on a compact screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/#/movement");
  const selector = page.getByLabel("Distance unit", { exact: true });
  for (const unit of ["mm", "cm", "m", "km", "in", "ft", "yd", "mi"]) {
    await selector.selectOption(unit);
    await expect(
      page
        .locator(".stat")
        .filter({ hasText: "Cursor distance" })
        .locator("strong"),
    ).toHaveText(`0 ${unit}`);
    await expect(
      page
        .locator(".stat")
        .filter({ hasText: "Average speed" })
        .locator("strong"),
    ).toHaveText(`0 ${unit}/s`);
    await expect(
      page.getByRole("img", {
        name: `Daily cursor distance in ${unit}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "History", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Daily cursor distance trend in mi" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page.getByLabel("Preferred distance unit")).toHaveValue("mi");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test("mobile navigation has labels, traps focus and closes after selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const trigger = page.locator(".mobile-menu-button");
  await expect(page.getByRole("navigation")).toBeHidden();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Close menu", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close menu", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.screenshot({ path: "test-results/mobile-navigation.png" });
  await page.getByRole("link", { name: "Focus", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Focus", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Focus | Trace");
  await expect(page.getByRole("navigation")).toBeHidden();
  await trigger.click();
  await page.getByRole("link", { name: "Trace overview" }).click();
  await expect(page).toHaveTitle("Overview | Trace");
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
});

test("unknown routes show a recovery page and both entries have browser metadata", async ({
  page,
}) => {
  for (const url of ["/#/missing-page", "/missing-page"]) {
    await page.goto(url);
    await expect(
      page.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Page not found | Trace");
    await expect(page.getByLabel("Date range")).toHaveCount(0);
    await page.getByRole("link", { name: "Back to Overview" }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
  }
  for (const url of ["/", "/trace-bar.html"]) {
    await page.goto(url);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Trace/,
    );
    const icon = await page.locator('link[rel="icon"]').getAttribute("href");
    const response = await page.request.get(icon!);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("<svg");
  }
});
