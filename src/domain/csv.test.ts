import { describe, expect, it } from "vitest";
import { parseCsv, tasksToCsv } from "./csv";
import type { Task } from "./types";

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b,1","say ""hi""\nthere"\r\nx,,y\r\n')).toEqual([
      ["a", "b,1", 'say "hi"\nthere'],
      ["x", "", "y"],
    ]);
  });
  it("keeps a last row without a newline and survives an unterminated quote", () => {
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(parseCsv('a,"b')).toEqual([["a", "b"]]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("tasksToCsv", () => {
  const t = (o: Partial<Task>) => ({ id: "1", title: "T", description: "", listId: "l", status: "open", priority: 0, schedule: { kind: "none" }, deadline: null, recurrence: null, tags: [], completedAt: null, deletedAt: null, ...o }) as Task;
  const desc = 'a,"b"\nc';
  it("round-trips through parseCsv, defuses formulas and skips trashed tasks", () => {
    const csv = tasksToCsv([t({ title: "=SUM(1)", description: desc, tags: ["x", "y"], priority: 3, schedule: { kind: "day", date: "2026-11-16" }, recurrence: { rule: "FREQ=DAILY", exdates: [], tz: null } }), t({ deletedAt: "2026-01-01T00:00:00Z" })], () => "Work", (id) => id);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["'=SUM(1)", "Work", "open", "High", "2026-11-16", "", "", "FREQ=DAILY", "x;y", desc, ""]);
  });
});
