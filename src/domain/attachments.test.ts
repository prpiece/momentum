import { describe, expect, it } from "vitest";
import { attachmentRefs, imageType, isAttachmentName, staleAttachments, toUpload, uploadOutcome } from "./attachments";

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

describe("note image uploads (D291)", () => {
  it("uploads referenced local files not yet settled, once", () => {
    const refs = attachmentRefs(["![](attachment:a.png) ![](attachment:b.jpg) ![](attachment:c.gif)"]);
    expect(toUpload(refs, ["a.png", "b.jpg", "stray.png"], new Set(["b.jpg"]))).toEqual(["a.png"]);
    expect(toUpload(refs, ["a.png"], new Set(["a.png"]))).toEqual([]);
  });
  it("maps image names to the bucket's types", () => {
    expect(imageType("x.PNG")).toBe("image/png");
    expect(imageType("x.jpg")).toBe("image/jpeg");
    expect(imageType("x.svg")).toBeNull();
  });
  it("counts a duplicate or a permanent refusal as done, retries the rest", () => {
    expect(uploadOutcome(null)).toBe("done");
    expect(uploadOutcome({ statusCode: "409", message: "The resource already exists" })).toBe("done");
    expect(uploadOutcome({ statusCode: "413", message: "Payload too large" })).toBe("done");
    expect(uploadOutcome({ statusCode: "403", message: "new row violates row-level security policy" })).toBe("retry");
    expect(uploadOutcome({ message: "Failed to fetch" })).toBe("retry");
  });
});

describe("isAttachmentName", () => {
  it.each([
    ["a.png", true],
    ["0b1c-2d_E.pdf", true],
    ["photo.PNG", true],
    ["a".repeat(64) + ".png", true],
    ["a".repeat(65) + ".png", false],
    ["../x.png", false],
    ["a/b.png", false],
    ["..\\x.png", false],
    ["x.png\n", false],
    ["é.png", false],
    ["", false],
    [".png", false],
    ["noext", false],
    ["a.b.png", false],
  ])("%j -> %s", (name, ok) => expect(isAttachmentName(name)).toBe(ok));
});
