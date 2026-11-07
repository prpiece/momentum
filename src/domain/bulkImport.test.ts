import { describe, expect, it } from "vitest";
import { IMPORT_CAP, splitImport } from "./bulkImport";

const titles = (text: string, sep?: string) => splitImport(text, sep).items.map((i) => i.text);

describe("splitImport", () => {
  it("splits lines, strips markers, skips blanks", () => {
    const text = "- Milk\r\n* Eggs\n\n• Bread\n1. Call mum\n2) Pay rent\n[ ] Gym\n- [x] 3. Stacked\n  -dash-word  ";
    expect(titles(text)).toEqual(["Milk", "Eggs", "Bread", "Call mum", "Pay rent", "Gym", "Stacked", "-dash-word"]);
  });
  it("strips letter, roman and bracketed markers", () => {
    expect(titles("a) bulk\nB. Second\n(c) third\nii) roman\nIV. four\n(3) bracketed\n- (a) stacked")).toEqual(["bulk", "Second", "third", "roman", "four", "bracketed", "stacked"]);
  });
  it("keeps words that only look like markers", () => {
    expect(titles("a plan\nI am done\nMix. it\nvia email")).toEqual(["a plan", "I am done", "Mix. it", "via email"]);
  });
  it("keeps numbers that are part of the title", () => {
    expect(titles("2024 taxes\n10am standup")).toEqual(["2024 taxes", "10am standup"]);
  });
  it("nests indented lines as subtasks", () => {
    const text = "* Main task\n   * Sub task\n   * sub task\n      - deeper\n   Third sub\n* Next";
    expect(splitImport(text).items).toEqual([
      { text: "Main task", parent: null },
      { text: "Sub task", parent: 0 },
      { text: "sub task", parent: 0 },
      { text: "deeper", parent: 2 },
      { text: "Third sub", parent: 0 },
      { text: "Next", parent: null },
    ]);
  });
  it("nests tab-indented lines", () => {
    const parents = splitImport("Main\n\tSub\n\t\tDeeper\n\tSub 2").items.map((i) => i.parent);
    expect(parents).toEqual([null, 0, 1, 0]);
  });
  it("caps nesting at the subtask depth limit", () => {
    const text = Array.from({ length: 8 }, (_, i) => `${" ".repeat(i * 2)}- L${i}`).join("\n");
    const items = splitImport(text).items;
    const depth = (i: number): number => {
      const p = items[i].parent;
      return p === null ? 0 : 1 + depth(p);
    };
    expect(items.map((_, i) => depth(i))).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
  });
  it("splits on a custom separator, flat", () => {
    expect(splitImport("a; b ;;\n c;", ";").items).toEqual(["a", "b", "c"].map((text) => ({ text, parent: null })));
  });
  it("caps and reports the total", () => {
    const r = splitImport(Array.from({ length: IMPORT_CAP + 5 }, (_, i) => `t${i}`).join("\n"));
    expect(r.items).toHaveLength(IMPORT_CAP);
    expect(r.total).toBe(IMPORT_CAP + 5);
  });
});
