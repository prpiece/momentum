import { beforeEach, describe, expect, it } from "vitest";
import { addTask, ensureTags, replaceAll, useData } from "./data";
import { useSettings } from "./settings";
import { createFromTemplate, saveAsTemplate } from "./templates";

beforeEach(() => replaceAll({ tasks: [], events: [], lists: [], folders: [], sections: [], tags: [] }));

describe("templates (FEAT-02)", () => {
  it("saves a tree and makes an independent copy with fresh ids and unticked items", () => {
    const root = addTask({ title: "Onboard", tags: ensureTags(["hr"]), checklist: [{ id: "c", title: "Badge", done: true }] });
    addTask({ title: "Laptop", parentId: root.id, listId: root.listId });
    saveAsTemplate(root.id);
    const id = createFromTemplate(useSettings.getState().settings.templates[0].id, "inbox")!;
    const all = Object.values(useData.getState().tasks);
    expect(all).toHaveLength(4);
    const copy = useData.getState().tasks[id];
    expect(copy.id).not.toBe(root.id);
    expect(copy.checklist).toMatchObject([{ title: "Badge", done: false }]);
    expect(all.filter((t) => t.parentId === id).map((t) => t.title)).toEqual(["Laptop"]);
    expect(copy.tags).toHaveLength(1);
  });
});
