import { describe, expect, it } from "vitest";
import { clipText, MAX_TEXT_PREVIEW, previewKind } from "./attachmentPreview";

describe("attachment preview", () => {
  it("classifies by extension", () => {
    expect(previewKind("a.PDF")).toBe("pdf");
    expect(previewKind("a.txt")).toBe("text");
    expect(previewKind("a.jpg")).toBe("image");
    expect(previewKind("a.docx")).toBeNull();
  });
  it("clips long text", () => {
    expect(clipText("hi")).toEqual({ text: "hi", cut: false });
    const r = clipText("x".repeat(MAX_TEXT_PREVIEW + 5));
    expect(r.cut).toBe(true);
    expect(r.text).toHaveLength(MAX_TEXT_PREVIEW);
  });
});
