import { describe, expect, it } from "vitest";
import { advance, elapsedMs, formatClock, pause, remainingMs, resume, start, stop, DEFAULT_POMODORO as C } from "./focus";

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
  it("formats the clock", () => {
    expect(formatClock(25 * min)).toBe("25:00");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});
