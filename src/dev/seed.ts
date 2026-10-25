/*
 * Realistic sample data relative to "today". Loaded automatically in browser dev mode
 * (no persistence there) and on demand from Settings → Developer in `tauri dev`.
 * Never bundled into a code path that runs in release builds (gated on import.meta.env.DEV).
 */
import { addDaysLocal, atLocalTime, timed, todayLocal } from "../domain/dates";
import type { Folder, Priority, Schedule, Section, Tag, Task, TaskList } from "../domain/types";
import type { Workspace } from "../db/repo";

const id = () => crypto.randomUUID();

export function sampleWorkspace(today = todayLocal()): Workspace {
  const now = new Date().toISOString();
  const d = (n: number) => addDaysLocal(today, n);
  const day = (n: number): Schedule => ({ kind: "day", date: d(n) });
  const at = (n: number, time: string, minutes = 60): Schedule => timed(atLocalTime(d(n), time), minutes);

  const folders: Folder[] = [{ id: id(), name: "Uni", sortOrder: 0, collapsed: false }];
  const mk = (name: string, emoji: string, color: string, sortOrder: number, folderId: string | null = null): TaskList => ({
    id: id(),
    name,
    emoji,
    color,
    folderId,
    pinned: false,
    archived: false,
    tint: false,
    layout: "list",
    sortOrder,
  });
  const work = mk("Work", "💼", "#2f6fed", 1);
  const home = mk("Home", "🏠", "#2f9358", 2);
  const chem = mk("Chemistry", "🧪", "#8a4fd8", 3, folders[0].id);
  const essay = { ...mk("History essay", "📝", "#d18a14", 4, folders[0].id), layout: "kanban" as const };
  const lists = [work, home, chem, essay];

  const sections: Section[] = ["Research", "Drafting", "Editing"].map((name, i) => ({ id: id(), listId: essay.id, name, sortOrder: i }));
  const tags: Tag[] = ["school", "errand", "deep-work", "health"].map((name) => ({ id: id(), name, color: null }));
  const [school, errand, deep, health] = tags.map((t) => t.id);

  let order = 0;
  const task = (title: string, p: Partial<Task> = {}): Task => ({
    id: id(),
    title,
    description: "",
    listId: "inbox",
    parentId: null,
    sectionId: null,
    status: "open",
    priority: 0 as Priority,
    schedule: { kind: "none" },
    recurrence: null,
    recurrenceParentId: null,
    tags: [],
    checklist: [],
    reminders: [],
    sortOrder: order++,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
    ...p,
  });

  const lab = task("Write up titration lab", {
    listId: chem.id,
    priority: 3,
    schedule: day(1),
    tags: [school],
    description: "Include **error analysis** and the graph from session 2.\n\n- Method\n- Results\n- Discussion",
    reminders: [{ kind: "dayOf", daysBefore: 0, time: "09:00" }],
  });
  const tasks: Task[] = [
    task("Study chem", { listId: chem.id, priority: 3, schedule: at(0, "17:00", 90), tags: [school, deep] }),
    lab,
    task("Results table", { listId: chem.id, parentId: lab.id }),
    task("Error analysis", { listId: chem.id, parentId: lab.id, status: "done", completedAt: now }),
    task("Read chapter 7: kinetics", { listId: chem.id, schedule: day(3), tags: [school] }),
    task("Quiz revision", { listId: chem.id, priority: 2, schedule: day(-1), tags: [school] }),
    task("Find 5 primary sources", { listId: essay.id, sectionId: sections[0].id, priority: 2, tags: [school] }),
    task("Outline argument", { listId: essay.id, sectionId: sections[1].id }),
    task("Intro paragraph", { listId: essay.id, sectionId: sections[1].id }),
    task("Bibliography format", { listId: essay.id, sectionId: sections[2].id, priority: 1 }),
    task("Team standup", { listId: work.id, schedule: at(0, "09:30", 15), recurrence: { rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", exdates: [] } }),
    task("Prepare Q4 planning deck", {
      listId: work.id,
      priority: 3,
      schedule: at(2, "14:00", 120),
      tags: [deep],
      checklist: [
        { id: id(), title: "Pull metrics", done: true },
        { id: id(), title: "Draft narrative", done: false },
        { id: id(), title: "Review with Sam", done: false },
      ],
    }),
    task("Reply to vendor email", { listId: work.id, priority: 1, schedule: day(0) }),
    task("Expense report", { listId: work.id, priority: 2, schedule: day(-2) }),
    task("1:1 with manager", { listId: work.id, schedule: at(1, "11:00", 30) }),
    task("Pay rent", { listId: home.id, priority: 3, schedule: day(4), recurrence: { rule: "FREQ=MONTHLY", exdates: [] }, reminders: [{ kind: "dayOf", daysBefore: 1, time: "18:00" }] }),
    task("Groceries", { listId: home.id, schedule: day(0), tags: [errand], checklist: ["Oats", "Spinach", "Coffee", "Eggs"].map((title) => ({ id: id(), title, done: false })) }),
    task("Book dentist", { listId: home.id, priority: 1, tags: [health, errand] }),
    task("Gym", { listId: home.id, schedule: at(0, "07:00", 60), tags: [health], recurrence: { rule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", exdates: [] } }),
    task("Water plants", { listId: home.id, schedule: day(1), recurrence: { rule: "FREQ=DAILY;INTERVAL=3", exdates: [] } }),
    task("Call mom", { schedule: day(5) }),
    task("Look into a standing desk", {}),
    task("Renew passport", { priority: 2, schedule: day(12), tags: [errand] }),
    task("Clean out downloads folder", { status: "done", completedAt: now }),
    task("Learn Spanish", { status: "wont_do" }),
  ];
  return { tasks, lists, folders, sections, tags };
}
