import { describe, expect, it } from "vitest";
import { contextForView, contextLabel, patchForContext } from "./quickAddContext";
import type { TaskList } from "./types";

const lists = { inbox: { id: "inbox", name: "Inbox" }, w: { id: "w", name: "Work" } } as unknown as Record<string, TaskList>;

describe("quick-add context", () => {
  it("maps views", () => {
    expect(contextForView("calendar", lists, "2026-03-05")).toEqual({ kind: "day", date: "2026-03-05" });
    expect(contextForView("list:w", lists, "2026-03-05")).toEqual({ kind: "list", listId: "w", name: "Work" });
    expect(contextForView("inbox", lists, "2026-03-05")).toEqual({ kind: "list", listId: "inbox", name: "Inbox" });
    expect(contextForView("list:gone", lists, "2026-03-05")).toBeNull();
    expect(contextForView("matrix", lists, "2026-03-05")).toBeNull();
  });
  it("patches tasks", () => {
    expect(patchForContext({ kind: "day", date: "2026-03-05" }, () => true)).toEqual({ schedule: { kind: "day", date: "2026-03-05" } });
    expect(patchForContext({ kind: "list", listId: "w", name: "Work" }, () => true)).toEqual({ listId: "w" });
    expect(patchForContext({ kind: "list", listId: "w", name: "Work" }, () => false)).toEqual({});
    expect(patchForContext(null, () => true)).toEqual({});
  });
  it("labels", () => {
    expect(contextLabel({ kind: "list", listId: "w", name: "Work" }, "2026-03-05")).toBe("Work");
    expect(contextLabel({ kind: "day", date: "2026-03-05" }, "2026-03-05")).toBe("Today");
  });
});
