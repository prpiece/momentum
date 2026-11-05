import { describe, expect, it } from "vitest";
import { IMPORT_CAP, splitImport } from "./bulkImport";

describe("splitImport", () => {
  it("splits lines, strips markers, skips blanks", () => {
    const text = "- Milk\r\n* Eggs\n\n• Bread\n1. Call mum\n2) Pay rent\n[ ] Gym\n- [x] 3. Stacked\n  -dash-word  ";
    expect(splitImport(text).items).toEqual(["Milk", "Eggs", "Bread", "Call mum", "Pay rent", "Gym", "Stacked", "-dash-word"]);
  });
  it("keeps numbers that are part of the title", () => {
    expect(splitImport("2024 taxes\n10am standup").items).toEqual(["2024 taxes", "10am standup"]);
  });
  it("splits on a custom separator", () => {
    expect(splitImport("a; b ;;\n c;", ";").items).toEqual(["a", "b", "c"]);
  });
  it("caps and reports the total", () => {
    const r = splitImport(Array.from({ length: IMPORT_CAP + 5 }, (_, i) => `t${i}`).join("\n"));
    expect(r.items).toHaveLength(IMPORT_CAP);
    expect(r.total).toBe(IMPORT_CAP + 5);
  });
});
