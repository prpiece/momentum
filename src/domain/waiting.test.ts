import { describe, expect, it } from "vitest";
import { blockerOpen, followUpDue, isWaiting, parseWaiting, waitLoops } from "./waiting";
import type { Waiting } from "./types";

describe("parseWaiting", () => {
  it("keeps valid waits and drops malformed ones", () => {
    expect(parseWaiting({ kind: "person", who: " Sam ", followUp: "2026-10-30" })).toEqual({ kind: "person", who: "Sam", followUp: "2026-10-30" });
    expect(parseWaiting({ kind: "task", taskId: "b" })).toEqual({ kind: "task", taskId: "b" });
    for (const bad of [null, "x", { kind: "person", who: "", followUp: "2026-10-30" }, { kind: "person", who: "a", followUp: "2026-02-30" }, { kind: "task" }, { kind: "other" }])
      expect(parseWaiting(bad)).toBeNull();
  });
});

describe("waitLoops", () => {
  const on = (id: string): Waiting => ({ kind: "task", taskId: id });
  it("refuses waiting on itself or closing a loop", () => {
    const tasks = { a: { waiting: null }, b: { waiting: on("c") }, c: { waiting: on("a") } };
    expect(waitLoops("a", on("a"), tasks)).toBe(true);
    expect(waitLoops("a", on("b"), tasks)).toBe(true);
    expect(waitLoops("x", on("b"), { ...tasks, c: { waiting: null } })).toBe(false);
    expect(waitLoops("a", { kind: "person", who: "s", followUp: "2026-10-30" }, tasks)).toBe(false);
    expect(waitLoops("a", null, tasks)).toBe(false);
  });
});

describe("coming back", () => {
  const person: Waiting = { kind: "person", who: "Sam", followUp: "2026-10-30" };
  it("a person's wait comes back on the follow-up date", () => {
    expect(isWaiting(person, false, "2026-10-29")).toBe(true);
    expect(isWaiting(person, false, "2026-10-30")).toBe(false);
    expect(followUpDue(person, "2026-10-29")).toBe(false);
    expect(followUpDue(person, "2026-10-31")).toBe(true);
  });
  it("a task's wait comes back once the other task is finished or gone", () => {
    const w: Waiting = { kind: "task", taskId: "b" };
    expect(blockerOpen(w, { b: { status: "open", deletedAt: null } })).toBe(true);
    expect(blockerOpen(w, { b: { status: "done", deletedAt: null } })).toBe(false);
    expect(blockerOpen(w, { b: { status: "open", deletedAt: "2026-10-01T00:00:00.000Z" } })).toBe(false);
    expect(blockerOpen(w, {})).toBe(false);
    expect(isWaiting(w, true, "2026-10-29")).toBe(true);
    expect(isWaiting(w, false, "2026-10-29")).toBe(false);
  });
});
