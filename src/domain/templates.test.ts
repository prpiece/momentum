import { describe, expect, it } from "vitest";
import { parseTemplates, specFromTemplate, templateFromTask, withTemplate } from "./templates";
import type { Task } from "./types";

const base: Task = {
  id: "r", title: "Trip", description: "", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 2,
  schedule: { kind: "day", date: "2026-11-20" }, deadline: null, durationMin: null, waiting: null, recurrence: null, recurrenceParentId: null,
  tags: ["t1"], checklist: [{ id: "c", title: "Passport", done: true }], reminders: [], sortOrder: 0, pinned: false,
  createdAt: "", updatedAt: "", completedAt: null, deletedAt: null,
};
const tasks: Record<string, Task> = {
  r: base,
  k: { ...base, id: "k", title: "Book hotel", parentId: "r", schedule: { kind: "day", date: "2026-11-18" }, tags: [], checklist: [] },
  gone: { ...base, id: "gone", title: "Deleted", parentId: "r", deletedAt: "x" },
};

describe("templates", () => {
  const tpl = templateFromTask("r", tasks, (id) => (id === "t1" ? "travel" : undefined), "tid", "")!;
  it("saves the tree with offsets, tag names and unticked items, skipping deleted subtasks", () => {
    expect(tpl.name).toBe("Trip");
    expect(tpl.root.tags).toEqual(["travel"]);
    expect(tpl.root.checklist).toEqual(["Passport"]);
    expect(tpl.root.children.map((c) => [c.title, c.when?.offset])).toEqual([["Book hotel", -2]]);
  });
  it("builds a spec on another anchor, keeping spacing and fresh unticked items", () => {
    const s = specFromTemplate(tpl, "2026-12-01", () => "n");
    expect(s.schedule).toEqual({ kind: "day", date: "2026-12-01" });
    expect(s.children[0].schedule).toEqual({ kind: "day", date: "2025-11-29".replace("2025", "2026") });
    expect(s.checklist).toEqual([{ id: "n", title: "Passport", done: false }]);
  });
  it("parses defensively and replaces a same-name template", () => {
    expect(parseTemplates("x")).toEqual([]);
    expect(parseTemplates([{ id: "a", name: "A", root: { title: "x", priority: 9, children: [{ nope: 1 }] } }])[0].root).toMatchObject({ title: "x", priority: 0, children: [{ title: "Untitled" }] });
    expect(withTemplate([tpl], { ...tpl, id: "other", name: "trip" }).map((t) => t.id)).toEqual(["other"]);
  });
});
