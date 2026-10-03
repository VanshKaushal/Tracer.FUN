import { describe, it, expect } from "vitest";
import {
  sumStats,
  emptyStats,
  percentile,
  pixelDistance,
  convertPixelDistance,
  dateRange,
  baselineChange,
  scrollSteps,
} from "./metrics";
describe("presentation preserves metric semantics", () => {
  it("keeps signed scrolling separate from absolute wheel steps", () => {
    const s = emptyStats();
    s.scroll_delta = 0;
    s.scroll_abs_delta = 240;
    expect(scrollSteps(s)).toBe(2);
  });
  it("merges weighted speed samples and uses max for peak", () => {
    const a = emptyStats();
    const b = emptyStats();
    a.speed_count = 2;
    a.speed_sum = 100;
    a.max_speed = 80;
    b.speed_count = 1;
    b.speed_sum = 200;
    b.max_speed = 200;
    const s = sumStats([a, b]);
    expect(s.speed_sum / s.speed_count).toBe(100);
    expect(s.max_speed).toBe(200);
  });
  it("labels physical conversions as estimates", () => {
    expect(pixelDistance(96, "m").estimate).toBe(true);
    expect(pixelDistance(96, "px").estimate).toBe(false);
  });
  it("handles local calendar rollover without using UTC dates", () => {
    expect(dateRange("7 days", new Date(2026, 0, 3, 0, 1))).toEqual({
      start: "2025-12-28",
      end: "2026-01-03",
    });
  });
  it("requires fourteen recorded baseline days", () => {
    expect(baselineChange(100, 100, 13)).toBeNull();
    expect(baselineChange(100, 1400, 14)).toBe(0);
  });
  it("returns bounded approximate percentiles", () => {
    const s = emptyStats();
    s.speed_count = 10;
    s.max_speed = 50;
    s.speed_histogram[10] = 10;
    expect(percentile(s, 0.95)).toBeLessThanOrEqual(50);
    expect(percentile(emptyStats(), 0.95)).toBe(0);
  });
});

describe("distance unit conversions", () => {
  it.each([
    ["px", 96],
    ["mm", 25.4],
    ["cm", 2.54],
    ["m", 0.0254],
    ["km", 0.0000254],
    ["in", 1],
    ["ft", 1 / 12],
    ["yd", 1 / 36],
    ["mi", 1 / 63360],
  ])("converts 96 pixels at 96 DPI to %s", (unit, expected) => {
    expect(convertPixelDistance(96, String(unit)).value).toBeCloseTo(
      Number(expected),
      10,
    );
  });
  it("uses display DPI and a safe fallback", () => {
    expect(convertPixelDistance(192, "in", 192).value).toBeCloseTo(1);
    for (const dpi of [0, -1, NaN, Infinity]) {
      expect(convertPixelDistance(96, "in", dpi).value).toBeCloseTo(1);
    }
    expect(convertPixelDistance(96, "unknown")).toEqual({
      value: 96,
      unit: "px",
      estimate: false,
    });
  });
  it("keeps small kilometer values visible", () => {
    expect(pixelDistance(96, "km").value).not.toBe("0");
  });
});
