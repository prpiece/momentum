import { describe, expect, it } from "vitest";
import { parseRequest } from "./agentOps";

describe("agent op parsing (v1.2.1)", () => {
  it("refuses a blank tag and merges case-duplicates", () => {
    expect(() => parseRequest("update", { id: "a", tags: ["#"] })).toThrow(/single-word/);
    expect(() => parseRequest("update", { id: "a", tags: ["##"] })).toThrow(/single-word/);
    expect(parseRequest("update", { id: "a", tags: ["work", "Work", "#WORK", "home"] })).toMatchObject({ patch: { tags: ["work", "home"] } });
  });
  it("names the deadline field when it is bad", () => {
    expect(() => parseRequest("update", { id: "a", deadline: "someday" })).toThrow(/deadline must be/);
    expect(() => parseRequest("update", { id: "a", deadline: "tomorrow" })).toThrow(/deadline must be/);
    expect(parseRequest("update", { id: "a", deadline: "2026-11-02" })).toMatchObject({ patch: { deadline: "2026-11-02" } });
  });
  it("updates this occurrence by default, and takes a scope", () => {
    expect(parseRequest("update", { id: "a", title: "x" })).toMatchObject({ scope: "this" });
    expect(parseRequest("update", { id: "a", title: "x", scope: "all" })).toMatchObject({ scope: "all" });
    expect(() => parseRequest("update", { id: "a", title: "x", scope: "some" })).toThrow(/scope/);
    expect(() => parseRequest("update", { id: "a", scope: "all" })).toThrow(/Nothing to update/);
  });
  it("takes a scope on complete: this (default), all, or following as all (AGENT-17)", () => {
    expect(parseRequest("complete", { id: "a" })).toEqual({ op: "complete", id: "a", scope: "this" });
    expect(parseRequest("complete", { id: "a", scope: "all" })).toEqual({ op: "complete", id: "a", scope: "all" });
    expect(parseRequest("complete", { id: "a", scope: "following" })).toEqual({ op: "complete", id: "a", scope: "all" });
    expect(() => parseRequest("complete", { id: "a", scope: "some" })).toThrow(/scope must be/);
    expect(() => parseRequest("complete", { id: "a", scope: 1 })).toThrow(/scope must be/);
    expect(() => parseRequest("reopen", { id: "a", scope: "all" })).toThrow(/Unknown field/);
  });
  it("parses delete, restore and trash, with no bulk form", () => {
    expect(parseRequest("delete", { id: "abc" })).toEqual({ op: "delete", id: "abc", withSubtasks: false, scope: "this" });
    expect(parseRequest("delete", { id: "abc", withSubtasks: true })).toMatchObject({ withSubtasks: true });
    expect(() => parseRequest("delete", { id: "abc", withSubtasks: "yes" })).toThrow(/true or false/);
    expect(() => parseRequest("delete", { ids: ["a", "b"] })).toThrow(/Unknown field/);
    expect(() => parseRequest("delete", {})).toThrow(/id is required/);
    expect(parseRequest("restore", { id: "abc" })).toEqual({ op: "restore", id: "abc" });
    expect(parseRequest("trash", undefined)).toEqual({ op: "trash", limit: 50 });
  });
});

describe("structured add, includeArchived, checkin, events (AGENT-15/19/20)", () => {
  it("takes structured fields on add and refuses bad ones", () => {
    expect(parseRequest("add", { text: "x", date: "2026-12-01", time: "09:05", durationMin: 30, priority: "low", tags: ["a"], deadline: "none" })).toMatchObject({ fields: { planned: { kind: "day", date: "2026-12-01" }, time: "09:05", durationMin: 30, priority: 1, tags: ["a"], deadline: null } });
    expect(parseRequest("add", { text: "x" })).toMatchObject({ fields: null });
    expect(() => parseRequest("add", { text: "x", time: "25:00" })).toThrow(/HH:mm/);
    expect(() => parseRequest("add", { text: "x", pinned: true })).toThrow(/Unknown field/);
    expect(parseRequest("update", { id: "a", time: "08:00", pinned: false })).toMatchObject({ patch: { time: "08:00", pinned: false } });
  });
  it("parses includeArchived, checkin and events", () => {
    expect(parseRequest("list", { includeArchived: true })).toMatchObject({ includeArchived: true });
    expect(() => parseRequest("search", { text: "a", includeArchived: "yes" })).toThrow(/true or false/);
    expect(parseRequest("checkin", { habit: " Read ", delta: -1 })).toEqual({ op: "checkin", habit: "Read", date: null, delta: -1, value: null });
    expect(() => parseRequest("checkin", { habit: "a", delta: 1, value: 2 })).toThrow(/not both/);
    expect(() => parseRequest("checkin", { habit: "a", value: -1 })).toThrow(/negative/);
    expect(() => parseRequest("events", { from: "2026-12-05", to: "2026-12-01" })).toThrow(/before/);
    expect(parseRequest("events", {})).toEqual({ op: "events", from: null, to: null, limit: 50 });
  });
});
