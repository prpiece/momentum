import { describe, expect, it } from "vitest";
import { todayWidgetProps } from "./todayWidget";
import type { Task } from "./types";

const TODAY = "2026-10-25";
let n = 0;
const mk = (p: Partial<Task> = {}): Task => ({
  id: `t${++n}`, title: `Task ${n}`, description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 0,
  schedule: { kind: "day", date: TODAY }, recurrence: null, recurrenceParentId: null, tags: [], checklist: [], reminders: [], sortOrder: n,
  pinned: false, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", completedAt: null, deletedAt: null, ...p,
});
const byId = (...ts: Task[]) => Object.fromEntries(ts.map((t) => [t.id, t]));

describe("todayWidgetProps", () => {
  it("shows the first three open tasks for today, overdue first, and counts the rest", () => {
    const late = mk({ title: "Late", schedule: { kind: "day", date: "2026-10-20" } });
    const ts = [mk(), mk(), mk(), late, mk({ status: "done" }), mk({ schedule: { kind: "day", date: "2026-10-26" } }), mk({ schedule: { kind: "none" } })];
    const p = todayWidgetProps(byId(...ts), {}, TODAY);
    expect(p.items).toHaveLength(3);
    expect(p.items[0]).toEqual({ title: "Late", url: `momentum://task/${late.id}` });
    expect(p.more).toBe(1);
  });

  it("is empty when nothing is due", () => {
    expect(todayWidgetProps({}, {}, TODAY)).toEqual({ items: [], more: 0 });
  });
});
