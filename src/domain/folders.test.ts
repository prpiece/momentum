import { describe, expect, it } from "vitest";
import { canAddChild, canNest, childFolders, folderDepth, repairFolderParents } from "./folders";

const f = (id: string, parentId: string | null = null) => ({ id, parentId });
const map = (...fs: ReturnType<typeof f>[]) => Object.fromEntries(fs.map((x) => [x.id, x]));

describe("folders", () => {
  const tree = map(f("a"), f("b", "a"), f("c", "b"), f("x"), f("y", "x"));
  it("computes depth and children", () => {
    expect([folderDepth(tree, "a"), folderDepth(tree, "b"), folderDepth(tree, "c")]).toEqual([1, 2, 3]);
    expect(childFolders(tree, "a").map((n) => n.id)).toEqual(["b"]);
    expect(canAddChild(tree, "b")).toBe(true);
    expect(canAddChild(tree, "c")).toBe(false);
  });
  it("refuses self, cycles and depth overflow", () => {
    expect(canNest(tree, "a", "a")).toBe(false);
    expect(canNest(tree, "a", "c")).toBe(false);
    expect(canNest(tree, "x", "c")).toBe(false); // x+y subtree has height 2, c is depth 3
    expect(canNest(tree, "x", "b")).toBe(false); // 2 + 2 > 3
    expect(canNest(tree, "y", "b")).toBe(true);
    expect(canNest(tree, "x", "a")).toBe(true); // a>x>y is 3 deep
    expect(canNest(tree, "c", null)).toBe(true);
    expect(canNest(tree, "a", "nope")).toBe(false);
  });
  it("repairs dangling and cyclic parents", () => {
    const out = repairFolderParents([f("a", "ghost"), f("b", "c"), f("c", "b"), f("d", "a")]);
    expect(out.map((n) => n.parentId)).toEqual([null, null, null, "a"]);
  });
});
