import { beforeEach, describe, expect, it } from "vitest";
import { addList, addTask, replaceAll, useData } from "../stores/data";
import { hasSampleData, loadSampleData, removeSampleData } from "./sampleData";

beforeEach(() => replaceAll({ tasks: [], events: [], lists: [], folders: [], sections: [], tags: [] }));
const count = () => {
  const s = useData.getState();
  return { tasks: Object.keys(s.tasks).length, lists: Object.keys(s.lists).length, folders: Object.keys(s.folders).length, sections: Object.keys(s.sections).length };
};

describe("sample data (FEAT-26)", () => {
  it("loads once, with no finished tasks, and shows subtasks and a board", () => {
    expect(loadSampleData("2026-10-25")).toBe(true);
    expect(loadSampleData("2026-10-25")).toBe(false);
    const s = useData.getState();
    expect(hasSampleData()).toBe(true);
    expect(Object.values(s.tasks).every((t) => t.status === "open")).toBe(true);
    expect(Object.values(s.tasks).some((t) => t.parentId)).toBe(true);
    expect(Object.values(s.lists).some((l) => l.layout === "kanban")).toBe(true);
  });

  it("removes exactly what it added and leaves the user's own data", () => {
    const mine = addList("Mine");
    addTask({ title: "Keep me", listId: mine.id });
    addTask({ title: "Inbox thing" });
    const before = count();
    loadSampleData("2026-10-25");
    expect(count().tasks).toBeGreaterThan(before.tasks);
    expect(removeSampleData()).toBe(true);
    expect(count()).toEqual(before);
    expect(hasSampleData()).toBe(false);
    expect(removeSampleData()).toBe(false);
  });
});
