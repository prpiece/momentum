import { describe, expect, it } from "vitest";
import { parseExternalImport } from "./importExternal";
import { MAX_SUBTASK_DEPTH } from "./types";

const HEADER =
  '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId"';
const row = (f: Record<string, string>) => {
  const cols = ["Folder Name", "List Name", "Title", "Kind", "Tags", "Content", "Is Check list", "Start Date", "Due Date", "Reminder", "Repeat", "Priority", "Status", "Created Time", "Completed Time", "Order", "Timezone", "Is All Day", "Is Floating", "Column Name", "Column Order", "View Mode", "taskId", "parentId"];
  return cols.map((c) => `"${(f[c] ?? "").replace(/"/g, '""')}"`).join(",");
};
const file = (...rows: string[]) => `"Date: 2025-03-01+0000"\n"Version: 7.0"\n"Status: \n0 Normal\n1 Completed\n2 Archived"\n${HEADER}\n${rows.join("\n")}\n`;

describe("TickTick CSV", () => {
  const text = file(
    row({ "Folder Name": "Life", "List Name": "Errands", Title: "Buy milk", Tags: "shop, food", Content: "2% please", Priority: "5", Status: "0", "Start Date": "2025-03-04T05:00:00+0000", "Due Date": "2025-03-04T05:00:00+0000", Timezone: "America/New_York", "Is All Day": "true", Repeat: "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU", taskId: "1" }),
    row({ "Folder Name": "Life", "List Name": "Errands", Title: "Child", taskId: "2", parentId: "1", Priority: "3" }),
    row({ "Folder Name": "Life", "List Name": "Errands", Title: "Orphan child first", taskId: "3", parentId: "9" }),
    row({ "List Name": "Work", Title: "Meeting", "Start Date": "2025-03-05T15:00:00+0000", "Due Date": "2025-03-05T16:30:00+0000", "Is All Day": "false", "Column Name": "Doing", Status: "2", "Completed Time": "2025-03-05T17:00:00+0000", Priority: "1", Repeat: "TT_SKIP=HOLIDAY;FREQ=DAILY", taskId: "4" }),
    row({ "List Name": "Work", Title: "Packing", "Is Check list": "Y", Content: "▫Socks\n▪Shoes\nnote line", Kind: "CHECKLIST", taskId: "5", Repeat: "FREQ=DAILY" }),
    row({ "List Name": "Work", Title: "", taskId: "6" }),
  );
  const r = parseExternalImport(text);
  it("detects TickTick past the metadata lines", () => {
    expect(r.ok && r.source).toBe("ticktick");
  });
  const plan = r.ok ? r.plan : null;
  it("maps folders, lists, sections, subtasks, tags and priorities", () => {
    expect(plan!.folders).toEqual(["Life"]);
    expect(plan!.lists).toEqual([
      { id: "l1", name: "Errands", folder: "Life" },
      { id: "l2", name: "Work", folder: null },
    ]);
    expect(plan!.sections).toEqual([{ id: "s1", list: "l2", name: "Doing" }]);
    const milk = plan!.tasks.find((t) => t.title === "Buy milk")!;
    expect(milk).toMatchObject({ tags: ["shop", "food"], description: "2% please", priority: 3, rule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=TU" });
    expect(milk.schedule).toEqual({ kind: "day", date: "2025-03-04" });
    expect(plan!.tasks.find((t) => t.title === "Child")).toMatchObject({ parent: "1", priority: 2 });
    expect(plan!.tasks.find((t) => t.title === "Orphan child first")!.parent).toBeNull();
  });
  it("handles timed, completed, checklist and unreadable repeats", () => {
    const meeting = plan!.tasks.find((t) => t.title === "Meeting")!;
    expect(meeting).toMatchObject({ status: "done", section: "s1", priority: 1, completedAt: "2025-03-05T17:00:00.000Z", rule: null });
    expect(meeting.schedule).toEqual({ kind: "timed", start: "2025-03-05T15:00:00.000Z", end: "2025-03-05T16:30:00.000Z" });
    const pack = plan!.tasks.find((t) => t.title === "Packing")!;
    expect(pack.checklist).toEqual([{ title: "Socks", done: false }, { title: "Shoes", done: true }]);
    expect(pack.description).toBe("note line");
    expect(pack.rule).toBeNull(); // nothing to repeat from
    expect(plan!.counts).toMatchObject({ lists: 2, folders: 1, sections: 1, tasks: 5, subtasks: 1, tags: 2, completed: 1, repeatsKept: 1, repeatsNotKept: 2, skipped: 1 });
  });
  it("puts parents before children and caps nesting", () => {
    const rows = Array.from({ length: MAX_SUBTASK_DEPTH + 3 }, (_, i) => row({ "List Name": "Deep", Title: `n${i}`, taskId: `d${i}`, parentId: i ? `d${i - 1}` : "" })).reverse();
    const p = parseExternalImport(file(...rows));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const depth = (id: string | null): number => (id ? 1 + depth(p.plan.tasks.find((t) => t.id === id)!.parent) : 0);
    const seen = new Set<string>();
    for (const t of p.plan.tasks) {
      expect(t.parent === null || seen.has(t.parent)).toBe(true);
      seen.add(t.id);
      expect(depth(t.parent)).toBeLessThanOrEqual(MAX_SUBTASK_DEPTH);
    }
  });
  it("survives parent cycles and duplicate ids", () => {
    const p = parseExternalImport(file(row({ "List Name": "L", Title: "a", taskId: "a", parentId: "b" }), row({ "List Name": "L", Title: "b", taskId: "b", parentId: "a" }), row({ "List Name": "L", Title: "dup", taskId: "a" })));
    expect(p.ok && p.plan.counts).toMatchObject({ tasks: 2, skipped: 1 });
  });
});
