import { expect, it } from "vitest";
import { insertionIndex, placeAt } from "./kanbanDrop";

const col = [{ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 1 }];
const order = (m: Map<string, number>) => [...col.map((c) => ({ ...c, sortOrder: m.get(c.id) ?? c.sortOrder })), ...[...m].filter(([id]) => !col.some((c) => c.id === id)).map(([id, sortOrder]) => ({ id, sortOrder }))].sort((x, y) => x.sortOrder - y.sortOrder).map((x) => x.id);

it("places one and several cards at an index", () => {
  expect(order(placeAt(col, ["x"], 0))).toEqual(["x", "a", "b"]);
  expect(order(placeAt(col, ["x"], 1))).toEqual(["a", "x", "b"]);
  expect(order(placeAt(col, ["x", "y"], 1))).toEqual(["a", "x", "y", "b"]);
  expect(order(placeAt(col, ["x", "y"], 2))).toEqual(["a", "b", "x", "y"]);
  const e = placeAt([], ["x", "y"], 0);
  expect(e.get("x")! < e.get("y")!).toBe(true);
});
it("finds the insertion index", () => {
  expect(insertionIndex([10, 50, 90], 60)).toBe(2);
  expect(insertionIndex([], 5)).toBe(0);
});
