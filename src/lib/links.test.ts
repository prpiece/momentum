import { describe, expect, it } from "vitest";
import { webUrl } from "./links";

describe("webUrl", () => {
  it("allows http and https only", () => {
    expect(webUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(webUrl("http://example.com")).toBe("http://example.com/");
    for (const bad of ["javascript:alert(1)", "file:///C:/x", "momentum://x", "mailto:a@b.c", "/relative", "", null, undefined])
      expect(webUrl(bad)).toBeNull();
  });
});
