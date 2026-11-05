import { describe, expect, it } from "vitest";
import { changelogSection, compareVersions, missedSections, newsItems } from "./changelog";

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

describe("missedSections", () => {
  const md = ["## v0.10.0", "- Ten.", "## v0.9.1", "- Fix.", "## v0.9.0", "- Nine.", "## v0.8.1", "- Eight."].join("\n\n");
  it("returns every section after the seen version, newest first", () => {
    expect(missedSections(md, "0.8.1", "0.10.0").map((s) => s.version)).toEqual(["0.10.0", "0.9.1", "0.9.0"]);
  });
  it("stops at the running version and handles no seen version", () => {
    expect(missedSections(md, "0.8.1", "0.9.0").map((s) => s.version)).toEqual(["0.9.0"]);
    expect(missedSections(md, null, "0.9.1").map((s) => s.version)).toEqual(["0.9.1"]);
  });
  it("compares numerically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  });
});
