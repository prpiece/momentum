import { describe, expect, it } from "vitest";
import { isAlarm } from "./alarms";
import type { Fire } from "./reminders";

describe("isAlarm", () => {
  const f = (key: string, target: Fire["target"]) => ({ key, target });
  const task = { kind: "task", id: "a", occurrenceKey: null } as const;
  const prio = (p: 0 | 1 | 2 | 3) => (id: string) => (id === "a" ? p : undefined);
  it("rings for a high-priority task reminder only", () => {
    expect(isAlarm(f("task:a::x", task), prio(3))).toBe(true);
    expect(isAlarm(f("task:a::x", task), prio(2))).toBe(false);
    expect(isAlarm(f("task:b::x", { ...task, id: "b" }), prio(3))).toBe(false);
  });
  it("not for starting-now alerts, habits or the digest", () => {
    expect(isAlarm(f("start:a:x", task), prio(3))).toBe(false);
    expect(isAlarm(f("habit:a:d:t", { kind: "habit", id: "a" }), prio(3))).toBe(false);
    expect(isAlarm(f("digest:d", { kind: "digest" }), prio(3))).toBe(false);
  });
});
