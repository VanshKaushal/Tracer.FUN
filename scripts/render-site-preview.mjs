import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const cache = fileURLToPath(new URL(".browser-cache/", root));
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(cache)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = cache;
}
const { chromium } = await import("@playwright/test");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const source = readFileSync(new URL("website/social-preview.svg", root));
  await page.goto("data:image/svg+xml;base64," + source.toString("base64"));
  await page.screenshot({
    path: fileURLToPath(new URL("website/social-preview.png", root)),
    animations: "disabled",
  });
  console.log("Created the 1200 by 630 Trace social preview.");
} finally {
  await browser.close();
}
