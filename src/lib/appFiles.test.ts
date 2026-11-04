import { describe, expect, it } from "vitest";
import { newImageName } from "./appFiles";

describe("newImageName", () => {
  it("takes the extension from a MIME type or a file name", () => {
    expect(newImageName("image/png")).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(newImageName("C:\pics\Holiday.JPEG")).toMatch(/\.jpg$/);
    expect(newImageName("/home/me/a.b/cat.webp")).toMatch(/\.webp$/);
  });
  it("refuses anything that isn't an allowed image", () => {
    expect(newImageName("image/svg+xml")).toBeNull();
    expect(newImageName("notes.txt")).toBeNull();
  });
});
