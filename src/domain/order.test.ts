import { describe, expect, it } from "vitest";
import { after, before, reorder } from "./order";

const items = [
  { id: "a", sortOrder: 0 },
  { id: "b", sortOrder: 1 },
  { id: "c", sortOrder: 2 },
];

function apply(list: typeof items, changes: { id: string; sortOrder: number }[]) {
  const m = new Map(changes.map((c) => [c.id, c.sortOrder]));
  return list
    .map((i) => ({ ...i, sortOrder: m.get(i.id) ?? i.sortOrder }))
    .sort((x, y) => x.sortOrder - y.sortOrder)
    .map((i) => i.id);
}

describe("reorder", () => {
  it("moves to the middle with a single write", () => {
    const ch = reorder(items, "c", 1);
    expect(ch).toHaveLength(1);
    expect(apply(items, ch)).toEqual(["a", "c", "b"]);
  });

  it("moves to the ends", () => {
    expect(apply(items, reorder(items, "c", 0))).toEqual(["c", "a", "b"]);
    expect(apply(items, reorder(items, "a", 2))).toEqual(["b", "c", "a"]);
    expect(apply(items, reorder(items, "a", 99))).toEqual(["b", "c", "a"]);
  });

  it("handles a new item and an empty list", () => {
    expect(reorder([], "x", 0)).toEqual([{ id: "x", sortOrder: 0 }]);
    expect(apply([...items, { id: "x", sortOrder: 99 }], reorder(items, "x", 1))).toEqual(["a", "x", "b", "c"]);
  });

  it("renumbers when the gap is exhausted", () => {
    let list = [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
      { id: "m", sortOrder: 5 },
    ];
    // Repeatedly insert just after "a" until floats run out; order must stay correct throughout.
    for (let i = 0; i < 60; i++) {
      const ch = reorder(list, "m", 1);
      const m = new Map(ch.map((c) => [c.id, c.sortOrder]));
      list = list.map((x) => ({ ...x, sortOrder: m.get(x.id) ?? x.sortOrder }));
      expect([...list].sort((x, y) => x.sortOrder - y.sortOrder).map((x) => x.id)).toEqual(["a", "m", "b"]);
      list = list.map((x) => (x.id === "m" ? { ...x, sortOrder: 5 } : x)); // move it away again
      list = list.map((x) => (x.id === "b" ? { ...x, sortOrder: (list[0].sortOrder + x.sortOrder) / 2 } : x));
    }
  });

  it("computes append and prepend values", () => {
    expect(after(items)).toBe(3);
    expect(before(items)).toBe(-1);
    expect(after([])).toBe(0);
  });
});
