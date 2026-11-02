import { describe, expect, it } from "vitest";
import { collapse, enqueueInsight } from "./store";
import type { Insight } from "../types";
describe("Trace Bar state and notifications", () => {
  it("collapses in stages and keeps focus visible", () => {
    expect(collapse("expanded", false)).toBe("compact");
    expect(collapse("compact", false)).toBe("peek");
    expect(collapse("compact", true)).toBe("compact");
  });
  it("expires old cards and bounds the queue without replacing critical messages", () => {
    const card = (id: string, priority: number, expires_ts = 100): Insight => ({
      id,
      priority,
      expires_ts,
      title: id,
      message: id,
      route: "/",
    });
    let queue = [
      card("critical", 0),
      card("focus", 2),
      card("reminder", 3),
      card("expired", 1, 0),
    ];
    queue = enqueueInsight(queue, card("record", 4), 1);
    expect(queue.map((i) => i.id)).toEqual(["critical", "focus", "reminder"]);
    expect(
      enqueueInsight(queue, card("focus", 2), 1).filter(
        (i) => i.id === "focus",
      ),
    ).toHaveLength(1);
  });
});
