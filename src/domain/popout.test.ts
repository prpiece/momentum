import { describe, expect, it } from "vitest";
import { parsePopState, parsePopView, pushEntry, trayTooltip, undoThrough, type UndoEntry } from "./popout";

const e = (id: number): UndoEntry => ({ id, message: `m${id}`, source: "you", at: id });

describe("popout", () => {
  it("tray tooltip", () => {
    expect(trayTooltip(0, null)).toBe("Momentum: nothing left today");
    expect(trayTooltip(3, "Standup")).toBe("Momentum: 3 left, next Standup");
  });
  it("accepts only list-like views", () => {
    expect(parsePopView("today")).toBe("today");
    expect(parsePopView("list:abc-1")).toBe("list:abc-1");
    expect(parsePopView("list:a&b")).toBeNull();
    expect(parsePopView("settings")).toBeNull();
  });
  it("validates state", () => {
    expect(parsePopState({ view: "today", title: "Today", tasks: [{ id: "1", key: null, title: "x" }] })?.tasks).toHaveLength(1);
    expect(parsePopState({ view: "today", title: "Today", tasks: [{ id: 1 }] })).toBeNull();
  });
  it("caps and undoes through an entry", () => {
    let l: UndoEntry[] = [];
    for (let i = 1; i <= 25; i++) l = pushEntry(l, e(i));
    expect(l).toHaveLength(20);
    const { revert, keep } = undoThrough(l, 23);
    expect(revert.map((x) => x.id)).toEqual([25, 24, 23]);
    expect(keep[keep.length - 1]?.id).toBe(22);
    expect(undoThrough(l, 99).revert).toEqual([]);
  });
});
