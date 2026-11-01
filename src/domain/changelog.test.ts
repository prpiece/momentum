import { describe, expect, it } from "vitest";
import { changelogSection, newsItems } from "./changelog";

const MD = `# Changelog

## v0.5.0

- **Big thing.** It does a lot.
  ![The big thing](whats-new/0.5.0/big.png)
- Small fix.

## v0.4.0

- Old news.
`;

describe("changelog", () => {
  it("finds a version's section and nothing past it", () => {
    expect(changelogSection(MD, "0.4.0")).toBe("- Old news.");
    expect(changelogSection(MD, "0.5.0")).toContain("Small fix.");
    expect(changelogSection(MD, "0.5.0")).not.toContain("Old news");
    expect(changelogSection(MD, "9.9.9")).toBeNull();
  });
  it("splits bullets and pulls out screenshots", () => {
    expect(newsItems(changelogSection(MD, "0.5.0") ?? "")).toEqual([
      { text: "**Big thing.** It does a lot.", image: { alt: "The big thing", src: "whats-new/0.5.0/big.png" } },
      { text: "Small fix.", image: null },
    ]);
  });
});
