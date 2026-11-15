import { describe, expect, it } from "vitest";
import { AgentError, agentTask, applyPlanned, parseRequest } from "./agentOps";
import { timed } from "./dates";
import type { Task } from "./types";

const base: Task = {
  id: "t1", title: "Call mom", description: "about Sunday", listId: "inbox", parentId: null, sectionId: null, status: "open", priority: 3,
  schedule: { kind: "day", date: "2026-10-30" }, deadline: "2026-11-02", durationMin: 15, waiting: null, recurrence: null, recurrenceParentId: null,
  tags: ["g1", "gone"], checklist: [], reminders: [], sortOrder: 1, pinned: false, createdAt: "2026-10-25T10:00:00.000Z", updatedAt: "2026-10-25T10:00:00.000Z", completedAt: null, deletedAt: null,
};

describe("agentTask", () => {
  it("shows an agent plain words, tag names and no internals", () => {
    const lists = { inbox: { id: "inbox", name: "Inbox" } } as never;
    const tags = { g1: { id: "g1", name: "family", color: null } };
    expect(agentTask(base, base.schedule, { lists, tags, subtasks: 2 })).toEqual({
      id: "t1", title: "Call mom", notes: "about Sunday", list: "Inbox", status: "open", priority: "high", planned: "2026-10-30", start: null,
      deadline: "2026-11-02", durationMin: 15, tags: ["family"], subtasks: 2, parentId: null,
    });
  });
  it("reports someday and time blocks", () => {
    const ctx = { lists: {}, tags: {}, subtasks: 0 };
    expect(agentTask(base, { kind: "someday" }, ctx).planned).toBe("someday");
    const t = agentTask(base, timed(new Date(2026, 9, 30, 9, 30), 45), ctx);
    expect([t.planned, t.start, t.durationMin]).toEqual(["2026-10-30", "09:30", 45]);
  });
});

describe("parseRequest", () => {
  it("applies defaults and clamps the limit", () => {
    expect(parseRequest("list", undefined)).toEqual({ op: "list", view: "today", limit: 50 });
    expect(parseRequest("list", { view: "Work", limit: 9999 })).toEqual({ op: "list", view: "Work", limit: 200 });
  });
  it("refuses unknown fields and unknown operations", () => {
    expect(() => parseRequest("get", { id: "a", sql: "x" })).toThrow(/Unknown field: sql/);
    expect(() => parseRequest("purge", { id: "a" })).toThrow(AgentError);
    expect(() => parseRequest("add", { text: "x", status: "done" })).toThrow(/Unknown field/);
    expect(() => parseRequest("get", "nope")).toThrow(/object/);
  });
  it("requires an id and text", () => {
    expect(() => parseRequest("complete", {})).toThrow(/id is required/);
    expect(() => parseRequest("add", { text: "  " })).toThrow(/non-empty/);
    expect(parseRequest("add", { text: "call mom by fri 15m", list: " Work ", parentId: "p" })).toEqual({ op: "add", text: "call mom by fri 15m", list: "Work", parentId: "p" });
  });
  it("validates a patch field by field", () => {
    const patch = parseRequest("update", { id: "a", title: " New ", priority: "High", date: "2026-11-01", deadline: "none", durationMin: 30, tags: ["#a", "b"], list: "Work" });
    expect(patch).toEqual({
      op: "update", id: "a", scope: "this",
      patch: { title: "New", priority: 3, planned: { kind: "day", date: "2026-11-01" }, deadline: null, durationMin: 30, tags: ["a", "b"], list: "Work" },
    });
    expect((parseRequest("update", { id: "a", date: "someday", durationMin: null }) as { patch: object }).patch).toEqual({ planned: { kind: "someday" }, durationMin: null });
  });
  it("rejects bad patch values and empty updates", () => {
    for (const bad of [{ date: "tomorrow" }, { date: "2026-02-30" }, { priority: "urgent" }, { priority: 7 }, { durationMin: 1.5 }, { durationMin: 5000 }, { deadline: "someday" }, { tags: ["two words"] }, { tags: "a" }, { status: "done" }, { completedAt: "x" }])
      expect(() => parseRequest("update", { id: "a", ...bad }), JSON.stringify(bad)).toThrow(AgentError);
    expect(() => parseRequest("update", { id: "a" })).toThrow(/Nothing to update/);
  });
});

describe("applyPlanned", () => {
  it("keeps a time block's wall-clock time and length when the day moves", () => {
    const s = applyPlanned(timed(new Date(2026, 9, 30, 9, 30), 45), { kind: "day", date: "2026-11-02" });
    expect(s.kind).toBe("timed");
    expect(s.kind === "timed" && new Date(s.start).getDate()).toBe(2);
  });
  it("plans an undated task for a day and clears or parks on request", () => {
    expect(applyPlanned({ kind: "none" }, { kind: "day", date: "2026-11-02" })).toEqual({ kind: "day", date: "2026-11-02" });
    expect(applyPlanned(base.schedule, { kind: "none" })).toEqual({ kind: "none" });
    expect(applyPlanned(base.schedule, { kind: "someday" })).toEqual({ kind: "someday" });
  });
});
