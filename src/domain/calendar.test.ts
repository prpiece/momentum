import { describe, expect, it } from "vitest";
import { calendarItems, dayRange, droppedSchedule, itemsOnDay, layoutDay, minutesInDay, rangeTitle, resizedSchedule, snap, stepAnchor, viewDays, type CalItem } from "./calendar";
import { atLocalTime, timed, wallKey } from "./dates";
import { toVM, type TaskVM } from "./taskViews";
import type { CalendarEvent, Schedule, Task } from "./types";

// TZ=America/New_York. 2026-10-25 is a Sunday.

function task(schedule: Schedule, p: Partial<Task> = {}): TaskVM {
  const t: Task = {
    id: Math.random().toString(36).slice(2),
    title: "T",
    description: "",
    listId: "inbox",
    parentId: null,
    sectionId: null,
    status: "open",
    priority: 0,
    schedule,
    recurrence: null,
    recurrenceParentId: null,
    tags: [],
    checklist: [],
    reminders: [],
    sortOrder: 0,
    pinned: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...p,
  };
  return toVM(t) as TaskVM;
}

function event(schedule: Schedule, p: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: Math.random().toString(36).slice(2),
    title: "E",
    notes: "",
    schedule,
    spanDays: 1,
    color: "#123456",
    recurrence: null,
    recurrenceParentId: null,
    source: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...p,
  };
}

const src = (tasks: TaskVM[], events: CalendarEvent[] = [], showCompleted = true) => ({ tasks, events, colorOf: () => "#000", showCompleted });

describe("ranges", () => {
  it("builds week and month grids from the week start", () => {
    expect(viewDays("week", "2026-10-28", 1)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(viewDays("week", "2026-10-28", 0)[0]).toBe("2026-10-25");
    const month = viewDays("month", "2026-10-15", 1);
    expect(month).toHaveLength(42);
    expect(month[0]).toBe("2026-09-28");
  });

  it("steps by view size and titles ranges", () => {
    expect(stepAnchor("week", "2026-10-28", 1)).toBe("2026-11-04");
    expect(stepAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(stepAnchor("5day", "2026-10-28", -1)).toBe("2026-10-23");
    expect(viewDays("5day", "2026-10-28", 1)).toEqual(dayRange("2026-10-28", 5));
    expect(dayRange("2026-10-30", 3)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(rangeTitle("week", viewDays("week", "2026-10-28", 1), "2026-10-28")).toBe("Oct 26 – Nov 1, 2026");
    expect(rangeTitle("month", [], "2026-10-28")).toBe("October 2026");
  });
});

describe("calendarItems", () => {
  it("expands recurring tasks into per-occurrence items within range", () => {
    const vm = task(timed(atLocalTime("2026-10-01", "09:00"), 30), { recurrence: { rule: "FREQ=DAILY", exdates: ["2026-10-27T09:00"] } });
    const items = calendarItems(src([vm]), "2026-10-26", "2026-10-28");
    expect(items.map((i) => i.key)).toEqual(["2026-10-26T09:00", "2026-10-28T09:00"]);
    expect(new Set(items.map((i) => i.uid)).size).toBe(2);
  });

  it("hides completed tasks when asked and always hides won't-do", () => {
    const done = task({ kind: "day", date: "2026-10-26" }, { status: "done" });
    const wont = task({ kind: "day", date: "2026-10-26" }, { status: "wont_do" });
    expect(calendarItems(src([done, wont]), "2026-10-26", "2026-10-26")).toHaveLength(1);
    expect(calendarItems(src([done], [], false), "2026-10-26", "2026-10-26")).toHaveLength(0);
  });

  it("spans multi-day all-day events, including ones that started before the range", () => {
    const e = event({ kind: "day", date: "2026-10-24" }, { spanDays: 4 });
    const [item] = calendarItems(src([], [e]), "2026-10-26", "2026-10-31");
    expect(item).toMatchObject({ startDate: "2026-10-24", endDate: "2026-10-27", allDay: true });
  });

  it("does not let a block ending at midnight spill into the next day", () => {
    const vm = task(timed(atLocalTime("2026-10-26", "23:00"), 60));
    const [item] = calendarItems(src([vm]), "2026-10-26", "2026-10-27");
    expect(item.endDate).toBe("2026-10-26");
  });
});

describe("layoutDay", () => {
  const at = (from: string, to: string, title = from): CalItem => ({
    uid: title,
    source: "task",
    id: title,
    key: null,
    title,
    allDay: false,
    startDate: "2026-10-26",
    endDate: "2026-10-26",
    start: atLocalTime("2026-10-26", from),
    end: atLocalTime("2026-10-26", to),
    color: "",
    done: false,
    recurring: false,
    readOnly: false,
    priority: 0,
  });
  const cols = (items: CalItem[]) => Object.fromEntries(layoutDay(items, "2026-10-26").map((p) => [p.item.title, [p.col, p.cols]]));

  it("places non-overlapping items full width", () => {
    expect(cols([at("09:00", "10:00", "a"), at("10:00", "11:00", "b")])).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it("puts overlapping items side by side and reuses freed columns", () => {
    expect(cols([at("09:00", "11:00", "a"), at("09:30", "10:00", "b"), at("10:15", "10:45", "c"), at("12:00", "13:00", "d")])).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [1, 2],
      d: [0, 1],
    });
  });

  it("chains transitive overlaps into one cluster", () => {
    const r = cols([at("09:00", "10:00", "a"), at("09:45", "11:00", "b"), at("10:30", "12:00", "c")]);
    expect(r).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2] });
  });

  it("clips multi-day timed items to the day", () => {
    const item = { ...at("22:00", "23:00", "x"), end: atLocalTime("2026-10-27", "02:00"), endDate: "2026-10-27" };
    expect(layoutDay([item], "2026-10-26")[0]).toMatchObject({ top: 22 * 60, bottom: 1440 });
    expect(layoutDay([item], "2026-10-27")[0]).toMatchObject({ top: 0, bottom: 120 });
  });

  it("uses wall-clock minutes on DST days", () => {
    expect(minutesInDay(atLocalTime("2026-03-08", "09:00"), "2026-03-08")).toBe(540);
    expect(minutesInDay(atLocalTime("2026-11-01", "09:00"), "2026-11-01")).toBe(540);
  });
});

describe("snap and day items", () => {
  it("snaps to 15 minutes within the day", () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(-30)).toBe(0);
    expect(snap(1500)).toBe(1440);
  });

  it("orders a day's items: all-day, then by start", () => {
    const items = calendarItems(
      src([task(timed(atLocalTime("2026-10-26", "15:00"), 30), { title: "late" }), task(timed(atLocalTime("2026-10-26", "08:00"), 30), { title: "early" }), task({ kind: "day", date: "2026-10-26" }, { title: "allday" })]),
      "2026-10-26",
      "2026-10-26",
    );
    expect(itemsOnDay(items, "2026-10-26").map((i) => i.title)).toEqual(["allday", "early", "late"]);
  });
});

describe("drop and resize math", () => {
  const block = timed(atLocalTime("2026-10-26", "09:00"), 45);
  const key = (s: Schedule) => (s.kind === "timed" ? `${wallKey(new Date(s.start))}..${wallKey(new Date(s.end))}` : JSON.stringify(s));

  it("moves into a time column keeping duration, snapped to 15 min", () => {
    expect(key(droppedSchedule(block, "2026-10-28", "time", 14 * 60 + 7))).toBe("2026-10-28T14:00..2026-10-28T14:45");
    expect(key(droppedSchedule({ kind: "none" }, "2026-10-28", "time", 8 * 60 + 50))).toBe("2026-10-28T08:45..2026-10-28T09:45");
  });

  it("converts to all-day or keeps the time of day for month cells", () => {
    expect(droppedSchedule(block, "2026-10-30", "allDay", 0)).toEqual({ kind: "day", date: "2026-10-30" });
    expect(key(droppedSchedule(block, "2026-10-30", "keepTime", 0))).toBe("2026-10-30T09:00..2026-10-30T09:45");
    expect(droppedSchedule({ kind: "day", date: "2026-10-01" }, "2026-10-30", "keepTime", 0)).toEqual({ kind: "day", date: "2026-10-30" });
  });

  it("never starts a block past 23:45", () => {
    expect(key(droppedSchedule(block, "2026-10-28", "time", 1440))).toBe("2026-10-28T23:45..2026-10-29T00:30");
  });

  it("resizes either edge with a minimum length", () => {
    expect(key(resizedSchedule(block, "end", 10 * 60 + 20, "2026-10-26"))).toBe("2026-10-26T09:00..2026-10-26T10:15");
    expect(key(resizedSchedule(block, "end", 8 * 60, "2026-10-26"))).toBe("2026-10-26T09:00..2026-10-26T09:15");
    expect(key(resizedSchedule(block, "start", 8 * 60, "2026-10-26"))).toBe("2026-10-26T08:00..2026-10-26T09:45");
    expect(key(resizedSchedule(block, "start", 10 * 60, "2026-10-26"))).toBe("2026-10-26T09:30..2026-10-26T09:45");
    expect(key(resizedSchedule(block, "end", 1440, "2026-10-26"))).toBe("2026-10-26T09:00..2026-10-27T00:00");
  });

  it("resizes on DST days by wall clock", () => {
    const s = timed(atLocalTime("2026-03-08", "01:00"), 60);
    expect(key(resizedSchedule(s, "end", 4 * 60, "2026-03-08"))).toBe("2026-03-08T01:00..2026-03-08T04:00");
  });
});
