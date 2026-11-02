import { describe, expect, it } from "vitest";
import { releaseNotes } from "./updater";

describe("releaseNotes", () => {
  it("keeps the changelog part and drops screenshots and install help", () => {
    const body = "- **Tour.** Shows you around.\n  ![Tour](https://raw.githubusercontent.com/x/y/v1/public/whats-new/t.png)\n- Fix.\n\n---\n\n### Install\n";
    expect(releaseNotes(body)).toBe("- **Tour.** Shows you around.\n- Fix.");
  });
});
