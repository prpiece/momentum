/*
 * Realistic sample data relative to "today". Loaded automatically in browser dev mode
 * (no persistence there) and on demand from Settings → Developer in `tauri dev`.
 * Never bundled into a code path that runs in release builds (gated on import.meta.env.DEV).
 */
import { addDaysLocal, atLocalTime, fromLocalDate, timed, todayLocal } from "../domain/dates";
import type { Habit, HabitCheckin, HabitGroup } from "../domain/habits";
import type { HabitData } from "../stores/habits";
import type { CalendarEvent, Folder, Priority, Schedule, Section, Tag, Task, TaskList } from "../domain/types";
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
    // A couple of weeks of finished work so Statistics has history.
    ...["Email landlord", "Submit timesheet", "Lab safety quiz", "Order textbook", "Fix bike light", "Plan meals", "Back up laptop", "Reply to Sam", "Laundry", "Pay phone bill", "Update CV", "Return library books", "Vacuum", "Read paper on catalysis", "Clean desk", "Call bank", "Buy birthday gift", "Weekly review", "Sort receipts", "Book haircut"].map((title, i) =>
      task(title, { listId: [work.id, home.id, chem.id, "inbox"][i % 4], status: "done", completedAt: atLocalTime(d(-1 - ((i * 7) % 13)), `${String(9 + (i % 9)).padStart(2, "0")}:30`).toISOString() }),
    ),
  ];
  const event = (title: string, schedule: Schedule, p: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: id(),
    title,
    notes: "",
    schedule,
    spanDays: 1,
    color: null,
    recurrence: null,
    recurrenceParentId: null,
    source: "local",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...p,
  });
  const events: CalendarEvent[] = [
    event("Chem lecture", at(0, "10:00", 90), { color: "#8a4fd8", recurrence: { rule: "FREQ=WEEKLY;BYDAY=MO,WE", exdates: [] } }),
    event("Lunch with Priya", at(1, "12:30", 60), { color: "#e1583f" }),
    event("Dentist", at(3, "15:00", 45), { color: "#0e8a85" }),
    event("Design review", at(2, "14:30", 60), { color: "#2f6fed" }),
    event("Long weekend", day(5), { spanDays: 3, color: "#d18a14" }),
  ];
  return { tasks, events, lists, folders, sections, tags };
}

/** Habits with ~6 weeks of plausible history (deterministic pseudo-random misses). */
export function sampleHabits(today = todayLocal()): HabitData {
  const start = addDaysLocal(today, -45);
  const habit = (name: string, icon: string, color: string, goal: Habit["goal"], frequency: Habit["frequency"], sortOrder: number, groupId: string | null = null): Habit => ({
    id: id(),
    name,
    icon,
    color,
    goal,
    frequency,
    reminders: [],
    groupId,
    sortOrder,
    archived: false,
    startDate: start,
    createdAt: new Date().toISOString(),
  });
  const groups: HabitGroup[] = [
    { id: id(), name: "Morning", sortOrder: 0 },
    { id: id(), name: "Health", sortOrder: 1 },
  ];
  const habits = [
    habit("Drink water", "💧", "#2f6fed", { kind: "count", target: 8, unit: "glasses" }, { kind: "daily" }, 0, groups[1].id),
    habit("Meditate", "🧘", "#8a4fd8", { kind: "once" }, { kind: "daily" }, 1, groups[0].id),
    habit("Run", "🏃", "#e1583f", { kind: "amount", target: 5, unit: "km" }, { kind: "perWeek", count: 2 }, 2, groups[1].id),
    habit("Read", "📚", "#d18a14", { kind: "count", target: 20, unit: "pages" }, { kind: "weekdays", days: [1, 2, 3, 4, 5] }, 3),
    habit("No phone after 10pm", "📵", "#0e8a85", { kind: "once" }, { kind: "daily" }, 4, groups[0].id),
  ];
  // Deterministic "random" so screenshots are stable.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const MOODS = [1, 2, 3, 4, 5] as const;
  const checkins: HabitCheckin[] = [];
  for (let i = 45; i >= 1; i--) {
    const date = addDaysLocal(today, -i);
    const dow = fromLocalDate(date).getDay();
    for (const h of habits) {
      const r = rand();
      if (h.frequency.kind === "weekdays" && !h.frequency.days.includes(dow)) continue;
      if (h.frequency.kind === "perWeek" && r > 0.4) continue;
      if (r > 0.82) continue;
      const value = h.goal.kind === "once" ? 1 : h.goal.kind === "count" ? (r > 0.3 ? h.goal.target : Math.ceil(h.goal.target * r)) : Math.round((4.5 + r * 3) * 10) / 10;
      checkins.push({ habitId: h.id, date, value, note: "", mood: i % 6 === 0 ? MOODS[(i / 6) % 5] : null });
    }
  }
  checkins.push({ habitId: habits[0].id, date: today, value: 3, note: "", mood: null });
  return { habits, groups, checkins };
}
