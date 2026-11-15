import { describe, expect, it } from "vitest";
import { trashItems } from "./trash";
import type { Task } from "./types";

const t = (id: string, p: Partial<Task> = {}): Task =>
  ({ id, title: id, listId: "inbox", parentId: null, schedule: { kind: "none" }, recurrence: null, deletedAt: null, ...p }) as Task;
const NOW = Date.parse("2026-11-15T12:00:00Z");

describe("trashItems", () => {
  it("lists one row per deletion with its subtasks, newest first, with days left", () => {
    const at = "2026-11-10T12:00:00.000Z";
    const tasks = {
      p: t("p", { deletedAt: at }),
      c: t("c", { parentId: "p", deletedAt: at }),
      later: t("later", { deletedAt: "2026-11-14T12:00:00.000Z" }),
      live: t("live"),
    };
    const items = trashItems(tasks, NOW);
    expect(items.map((i) => i.task.id)).toEqual(["later", "p"]);
    expect(items[1]).toMatchObject({ ids: ["p", "c"], daysLeft: 25 });
  });

  it("shows a subtask deleted on its own, and hides a series that ended by finishing", () => {
    const tasks = {
      p: t("p"),
      c: t("c", { parentId: "p", deletedAt: "2026-11-14T12:00:00.000Z" }),
      done: t("done", { deletedAt: "2026-11-14T12:00:00.000Z", schedule: { kind: "day", date: "2026-11-01" }, recurrence: { rule: "FREQ=DAILY;COUNT=1", exdates: ["2026-11-01"] } }),
    };
    expect(trashItems(tasks, NOW).map((i) => i.task.id)).toEqual(["c"]);
  });
});
