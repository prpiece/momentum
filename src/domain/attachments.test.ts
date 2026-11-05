import { describe, expect, it } from "vitest";
import { attachmentRefs, droppedAttachments, staleAttachments } from "./attachments";

describe("attachmentRefs", () => {
  it("finds every attachment: image reference across notes", () => {
    const refs = attachmentRefs(["a ![](attachment:one.png) b ![x](attachment:two.JPG)", "", "![](https://x/y.png) ![](attachment:one.png)"]);
    expect([...refs].sort()).toEqual(["one.png", "two.JPG"]);
  });
  it("ignores plain text and other schemes", () => {
    expect(attachmentRefs(["![](file:three.png)", "nothing here"]).size).toBe(0);
  });
});

describe("staleAttachments", () => {
  const DAY = 86400;
  const now = 100 * DAY;
  const files = [
    { name: "keep.png", modified: 0 },
    { name: "old.png", modified: now - 31 * DAY },
    { name: "new.png", modified: now - 29 * DAY },
  ];
  it("lists unreferenced files older than the cutoff", () => {
    expect(staleAttachments(files, new Set(["keep.png"]), now, 30)).toEqual(["old.png"]);
  });
});

describe("droppedAttachments", () => {
  it("lists files removed from a note that no other note holds", () => {
    const before = "![](attachment:a.png) ![](attachment:b.png) ![](attachment:c.png)";
    expect(droppedAttachments(before, "![](attachment:a.png)", ["dup ![](attachment:b.png)"])).toEqual(["c.png"]);
  });
  it("is empty when nothing was removed", () => {
    expect(droppedAttachments("![](attachment:a.png)", "x ![](attachment:a.png)", [])).toEqual([]);
  });
});
