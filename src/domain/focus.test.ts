import { describe, expect, it } from "vitest";
import { advance, elapsedMs, formatClock, pause, dueAutoFocus, pickLabel, rangeBetween, remainingMs, resume, start, stop, withRange, DEFAULT_POMODORO as C } from "./focus";
import type { TaskVM } from "./taskViews";

describe("focus timer", () => {
  const t0 = 1_000_000;
  const min = 60_000;
  it("counts down a pomodoro with pauses excluded", () => {
    let s = start("pomodoro", null, t0);
    s = pause(s, t0 + 10 * min);
    expect(remainingMs(s, t0 + 60 * min, C)).toBe(15 * min); // paused: clock frozen
    s = resume(s, t0 + 60 * min);
    expect(elapsedMs(s, t0 + 65 * min)).toBe(15 * min);
  });
  it("cycles focus → short → … → long every 4 rounds and records sessions", () => {
    let s = start("pomodoro", "task", t0);
    const phases: string[] = [];
    let now = t0;
    let sessions = 0;
    for (let i = 0; i < 8; i++) {
      now += 30 * min;
      const r = advance(s, now, C, `s${i}`);
      if (r.session) sessions++;
      s = r.state;
      phases.push(s.status === "running" || s.status === "paused" ? s.phase : s.status);
    }
    expect(phases).toEqual(["short", "focus", "short", "focus", "short", "focus", "long", "focus"]);
    expect(sessions).toBe(4);
  });
  it("caps a pomodoro session at the focus length and skips sessions under a minute", () => {
    const s = start("pomodoro", null, t0);
    expect(advance(s, t0 + 40 * min, C, "x").session?.seconds).toBe(25 * 60);
    expect(stop(start("stopwatch", null, t0), t0 + 30_000, C, "y").session).toBeNull();
    expect(stop(start("stopwatch", null, t0), t0 + 90 * min, C, "z").session?.seconds).toBe(90 * 60);
  });
  it("a finite session ends after its Nth focus phase with no final break", () => {
    let s = start("pomodoro", "task", t0, { kind: "finite", count: 2 });
    const seen: string[] = [];
    let sessions = 0;
    let now = t0;
    for (let i = 0; i < 3; i++) {
      now += 25 * min;
      const r = advance(s, now, C, `s${i}`);
      if (r.session) sessions++;
      s = r.state;
      seen.push(s.status === "running" ? s.phase : s.status);
    }
    expect(seen).toEqual(["short", "focus", "done"]);
    expect(sessions).toBe(2);
    expect(s).toMatchObject({ status: "done", taskId: "task", cycles: 2, focusMs: 50 * min });
    expect(advance(s, now + min, C, "n")).toEqual({ state: s, session: null });
    expect(stop(s, now, C, "n")).toEqual({ state: { status: "idle" }, session: null });
    expect(remainingMs(s, now, C)).toBeNull();
  });
  it("long breaks still land every longEvery rounds in a finite session", () => {
    const cfg = { ...C, longEvery: 2 };
    let s = start("pomodoro", null, t0, { kind: "finite", count: 3 });
    const phases: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = advance(s, t0 + (i + 1) * 30 * min, cfg, "x").state;
      phases.push(s.status === "running" ? s.phase : s.status);
    }
    expect(phases).toEqual(["short", "focus", "long", "focus", "done"]);
  });
  it("a skipped final focus phase counts its partial time", () => {
    const s = start("pomodoro", null, t0, { kind: "finite", count: 1 });
    expect(advance(s, t0 + 10 * min, C, "x").state).toMatchObject({ status: "done", cycles: 1, focusMs: 10 * min });
  });
  it("keeps chosen subtasks on the timer and credits the session to the task", () => {
    const s = start("stopwatch", "parent", t0, { kind: "infinite" }, ["a", "b"]);
    expect(s).toMatchObject({ taskId: "parent", subIds: ["a", "b"] });
    expect(stop(s, t0 + 30 * min, C, "id").session).toMatchObject({ taskId: "parent", seconds: 1800 });
  });
  it("selects subtask ranges in list order", () => {
    const order = ["a", "b", "c", "d"];
    expect(rangeBetween(order, "c", "a")).toEqual(["a", "b", "c"]);
    expect(rangeBetween(order, "x", "b")).toEqual(["b"]);
    expect(withRange(order, ["d"], ["b", "c"], true)).toEqual(["b", "c", "d"]);
    expect(withRange(order, ["a", "b", "c"], ["b"], false)).toEqual(["a", "c"]);
  });
  it("summarises the pick", () => {
    expect(pickLabel(null, [])).toBe("No specific task");
    expect(pickLabel("Review", [])).toBe("Review");
    expect(pickLabel("Review", ["Ch 1"])).toBe("Review › Ch 1");
    expect(pickLabel("Review topics", ["a", "b", "c"])).toBe("Review topics · 3 subtasks");
  });
  it("formats the clock", () => {
    expect(formatClock(25 * min)).toBe("25:00");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});

describe("dueAutoFocus", () => {
  const vm = (id: string, start: string, end: string, status: "open" | "done" = "open") =>
    ({ task: { id, title: id, status }, schedule: { kind: "timed", start, end }, date: null, key: null }) as unknown as TaskVM;
  const block = vm("a", "2026-10-25T14:00:00.000Z", "2026-10-25T15:00:00.000Z");
  const at = (s: string) => Date.parse(s);
  it("returns a block that started within the last minute", () => {
    expect(dueAutoFocus([block], at("2026-10-25T14:00:30.000Z"), null)?.taskId).toBe("a");
    expect(dueAutoFocus([block], at("2026-10-25T13:59:59.000Z"), null)).toBeNull();
    expect(dueAutoFocus([block], at("2026-10-25T14:01:00.000Z"), null)).toBeNull();
  });
  it("skips done tasks, day tasks and a block already started", () => {
    const now = at("2026-10-25T14:00:10.000Z");
    expect(dueAutoFocus([vm("a", "2026-10-25T14:00:00.000Z", "2026-10-25T15:00:00.000Z", "done")], now, null)).toBeNull();
    expect(dueAutoFocus([{ ...block, schedule: { kind: "day", date: "2026-10-25" } }], now, null)).toBeNull();
    expect(dueAutoFocus([block], now, dueAutoFocus([block], now, null)?.key ?? null)).toBeNull();
  });
});
