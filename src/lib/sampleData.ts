/*
 * Sample workspace for first-time users (FEAT-26): two lists inside one "Sample data" folder, filled through the
 * ordinary store actions, so it syncs and undoes like anything typed. Everything lives in that folder, so Remove
 * deletes exactly it (its lists, their sections and tasks) and nothing else. No finished tasks, so Progress stays honest.
 */
import { addDaysLocal, atLocalTime, timed, todayLocal } from "../domain/dates";
import type { LocalDate, Priority, Schedule } from "../domain/types";
import { addFolder, addList, addSection, addTask, type NewTask, removeFolder, removeList, uid, updateList, useData } from "../stores/data";

export const SAMPLE_FOLDER = "Sample data";

const sampleFolder = () => Object.values(useData.getState().folders).find((f) => f.name === SAMPLE_FOLDER);
export const hasSampleData = () => !!sampleFolder();

/** Adds the sample folder, lists and tasks, dated around `today`. Returns false when it is already there. */
export function loadSampleData(today: LocalDate = todayLocal()): boolean {
  if (sampleFolder()) return false;
  const folder = addFolder(SAMPLE_FOLDER);
  if (!folder) return false;
  const d = (n: number): Schedule => ({ kind: "day", date: addDaysLocal(today, n) });
  const at = (n: number, time: string, minutes: number): Schedule => timed(atLocalTime(addDaysLocal(today, n), time), minutes);
  const add = (listId: string, title: string, p: Partial<NewTask> = {},sectionId: string | null = null, parentId: string | null = null) =>
    addTask({ title, listId, sectionId, parentId, ...p }, "bottom");

  const launch = addList("Sample: Launch plan", folder.id);
  updateList(launch.id, { icon: "work", color: "#2f6fed", layout: "kanban" });
  const [plan, build, ship] = ["Plan", "Build", "Ship"].map((name) => addSection(launch.id, name));
  add(launch.id, "Write the one-page brief", { priority: 3 as Priority, schedule: d(0) }, plan.id);
  add(launch.id, "Agree the scope with the team", { priority: 2 as Priority, schedule: at(1, "10:00", 45) }, plan.id);
  const demo = add(launch.id, "Build the demo", { priority: 3 as Priority, schedule: d(3), deadline: addDaysLocal(today, 5) }, build.id);
  add(launch.id, "Sketch the screens", {}, build.id, demo.id);
  add(launch.id, "Record a short walkthrough", {}, build.id, demo.id);
  add(launch.id, "Announce it", { priority: 1 as Priority, schedule: d(7) }, ship.id);

  const home = addList("Sample: Home", folder.id);
  updateList(home.id, { icon: "home", color: "#2f9358" });
  add(home.id, "Water the plants", { schedule: d(0), recurrence: { rule: "FREQ=WEEKLY;BYDAY=MO,TH", exdates: [], tz: null } });
  add(home.id, "Groceries", { schedule: d(1), checklist: ["Oats", "Spinach", "Coffee"].map((title) => ({ id: uid(), title, done: false })) });
  add(home.id, "Book the dentist", { priority: 1 as Priority });
  add(home.id, "Call a friend", { schedule: at(2, "18:30", 30) });
  return true;
}

/** Deletes the sample folder with every list in it (their tasks and sections go too). Returns whether there was any. */
export function removeSampleData(): boolean {
  const folder = sampleFolder();
  if (!folder) return false;
  for (const l of Object.values(useData.getState().lists)) if (l.folderId === folder.id) removeList(l.id);
  removeFolder(folder.id);
  return true;
}
