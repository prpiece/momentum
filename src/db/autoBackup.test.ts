import { describe, expect, it } from "vitest";
import { autoBackupDue } from "./backup";

describe("autoBackupDue", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  it("is due when on and never run or older than 20h", () => {
    expect(autoBackupDue({ on: true, keep: 7, last: null }, now)).toBe(true);
    expect(autoBackupDue({ on: true, keep: 7, last: "2026-11-15T12:00:00Z" }, now)).toBe(true);
  });
  it("is not due when off or recent", () => {
    expect(autoBackupDue({ on: false, keep: 7, last: null }, now)).toBe(false);
    expect(autoBackupDue({ on: true, keep: 7, last: "2026-11-16T05:00:00Z" }, now)).toBe(false);
  });
});
