import { describe, expect, it } from "vitest";
import { atLocalTime, setDayEndHour, timed } from "./dates";
import { weeklyReview } from "./review";
import { toVM, type TaskVM } from "./taskViews";
import type { Task } from "./types";

const TODAY = "2026-10-25";
const task = (schedule: Task["schedule"], title = "T"): Task => ({
  id: title, title, description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 0, schedule, deadline: null,
  durationMin: null, waiting: null, recurrence: null, recurrenceParentId: null, tags: [], checklist: [], reminders: [], sortOrder: 0, pinned: false,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", completedAt: null, deletedAt: null,
});

describe("weeklyReview nextWeek", () => {
  it("a block at 01:30 on the 8th day belongs to day 7 with an end-of-day hour; one at 01:30 today to yesterday", () => {
    const edge = toVM(task(timed(atLocalTime("2026-11-02", "01:30"), 30), "edge")) as TaskVM; // today + 8 days
    const early = toVM(task(timed(atLocalTime(TODAY, "01:30"), 30), "early")) as TaskVM;
    const next = () => weeklyReview([edge, early], [], TODAY, 1).nextWeek.map((v) => v.task.title);
    expect(next()).toEqual(["early"]);
    setDayEndHour(3);
    try {
      expect(next()).toEqual(["edge"]); // day 7 now; early is yesterday
    } finally {
      setDayEndHour(0);
    }
  });
});
