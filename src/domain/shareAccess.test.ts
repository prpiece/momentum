import { describe, expect, it } from "vitest";
import { bestRole, sharesCoveringFolder, sharesCoveringList, type ShareLike } from "./shareAccess";

type Share = ShareLike & { shareId: string; ownerId: string; name: string | null; members: number };

const share = (p: Partial<Share>): Share => ({ shareId: "s", ownerId: "o", kind: "list", containerId: "l", name: null, role: "viewer", status: "active", members: 2, ...p });
const folders = { a: { id: "a", parentId: null }, b: { id: "b", parentId: "a" }, c: { id: "c", parentId: "b" }, d: { id: "d", parentId: "c" } };

describe("share access", () => {
  it("covers a list through its own share or a folder above it, within 3 levels", () => {
    const own = share({ shareId: "own", containerId: "l1" });
    const top = share({ shareId: "top", kind: "folder", containerId: "b", role: "editor" });
    const tooFar = share({ shareId: "far", kind: "folder", containerId: "a" });
    expect(sharesCoveringList([own, top], folders, { id: "l1", folderId: "c" }).map((s) => s.shareId)).toEqual(["own", "top"]);
    expect(sharesCoveringList([tooFar], folders, { id: "l2", folderId: "d" })).toEqual([]);
  });

  it("ignores invitations you haven't accepted", () => {
    expect(sharesCoveringList([share({ status: "invited" })], folders, { id: "l", folderId: null })).toEqual([]);
  });

  it("covers a folder through itself or a folder above it", () => {
    const s = share({ kind: "folder", containerId: "a" });
    expect(sharesCoveringFolder([s], folders, "c")).toEqual([s]);
    expect(sharesCoveringFolder([s], folders, "zzz")).toEqual([]);
  });

  it("takes the best role", () => {
    expect(bestRole([])).toBeNull();
    expect(bestRole([share({ role: "viewer" }), share({ role: "editor" })])).toBe("editor");
  });
});
