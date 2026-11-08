import { describe, expect, it } from "vitest";
import { keyParts } from "./keys";

const show = (k: string) => keyParts(k).map((p) => (p.kind === "key" ? `[${p.value}]` : p.value)).join(" ");

describe("keyParts", () => {
  it("gives one cap per key, with or without +", () => {
    expect(show("Ctrl Shift A")).toBe("[Ctrl] [Shift] [A]");
    expect(show("Ctrl + Shift + A")).toBe("[Ctrl] [Shift] [A]");
  });
  it("keeps separators and words as text", () => {
    expect(show("G I / G T / G U")).toBe("[G] [I] / [G] [T] / [G] [U]");
    expect(show("Space  or  C")).toBe("[Space] or [C]");
    expect(show("Ctrl / Shift + click")).toBe("[Ctrl] / [Shift] click");
  });
  it("treats a + that ends a binding as a key", () => {
    expect(show("Ctrl + / Ctrl − / Ctrl 0")).toBe("[Ctrl] [+] / [Ctrl] [−] / [Ctrl] [0]");
    expect(show("?")).toBe("[?]");
  });
});
