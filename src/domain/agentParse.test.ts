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
