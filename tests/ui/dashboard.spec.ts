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
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "History", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Daily cursor distance trend in mi" }),
  ).toBeVisible();
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
