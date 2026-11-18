import { describe, expect, it } from "vitest";
import type { TaskList } from "../../domain/types";
import { planListDrop } from "./sidebarMoves";

const l = (id: string, o: Partial<TaskList> = {}, sortOrder = 0): TaskList => ({ id, name: id, color: null, icon: null, folderId: null, pinned: false, archived: false, tint: false, layout: "list", sortOrder, ...o });
const lists = (...ls: TaskList[]) => Object.fromEntries(ls.map((x) => [x.id, x]));
const F = { f: {} };

describe("planListDrop", () => {
  it("drops on a sibling in the target's folder, at that spot", () => {
    const ls = lists(l("a", {}, 0), l("b", { folderId: "f" }, 1), l("c", { folderId: "f" }, 2));
    const p = planListDrop(ls, F, "a", "c")!;
    expect(p.folderId).toBe("f");
    const o = p.changes.find((c) => c.id === "a")!.sortOrder;
    expect(o).toBeLessThan(2);
    expect(o).toBeGreaterThan(1);
  });
  it("refuses a different pinned state, archived rows, self and unknown ids", () => {
    const ls = lists(l("a"), l("p", { pinned: true }), l("z", { archived: true }));
    expect(planListDrop(ls, F, "a", "p")).toBeNull();
    expect(planListDrop(ls, F, "p", "a")).toBeNull();
    expect(planListDrop(ls, F, "a", "z")).toBeNull();
    expect(planListDrop(ls, F, "z", "a")).toBeNull();
    expect(planListDrop(ls, F, "a", "a")).toBeNull();
    expect(planListDrop(ls, F, "a", "nope")).toBeNull();
  });
  it("in the rail, refuses a drop that would change the folder", () => {
    const ls = lists(l("a"), l("b", { folderId: "f" }), l("c", {}, 1));
    expect(planListDrop(ls, F, "a", "b", true)).toBeNull();
    expect(planListDrop(ls, F, "a", "c", true)).not.toBeNull();
    expect(planListDrop(ls, F, "a", "b", false)!.folderId).toBe("f");
  });
});
