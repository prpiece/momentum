import { describe, expect, it } from "vitest";
import type { CalItem } from "./calendar";
import { greeting, nextItems } from "./home";

const item = (o: Partial<CalItem> & { uid: string }): CalItem => ({
  source: "task", id: o.uid, key: null, title: o.uid, allDay: true, startDate: "2026-11-16", endDate: "2026-11-16", start: null, end: null,
  color: "", done: false, recurring: false, readOnly: false, priority: 0, ...o,
});
const at = (h: number) => new Date(2026, 10, 16, h);

describe("home", () => {
  it("greets by the hour", () => {
    expect([greeting(5), greeting(12), greeting(16), greeting(17), greeting(23)]).toEqual(["Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening"]);
  });
  it("lists what's next: drops finished, ended and non-task items, then sorts", () => {
    const timed = (uid: string, h: number) => item({ uid, allDay: false, start: at(h), end: at(h + 1) });
    const out = nextItems(
      [timed("late", 15), item({ uid: "tomorrow", startDate: "2026-11-17" }), timed("past", 8), item({ uid: "done", done: true }), item({ uid: "habit", source: "habit" }), timed("soon", 11), item({ uid: "allday" })],
      at(10),
      10,
    );
    expect(out.map((i) => i.uid)).toEqual(["allday", "soon", "late", "tomorrow"]);
    expect(nextItems(out, at(10), 2)).toHaveLength(2);
  });
});
