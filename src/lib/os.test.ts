import { describe, expect, it } from "vitest";
import { bindAll, shortcutProblem, shortcutTaken } from "./os";

describe("bindAll", () => {
  it("retries a shortcut that was waiting for another to release its accelerator", async () => {
    // mini B->C and quick add A->B saved together: quick add runs first and is refused until mini lets go of B.
    const held = new Set(["B"]);
    const bind = (from: string, to: string) => async () => {
      if (held.has(to)) return false;
      held.delete(from);
      held.add(to);
      return true;
    };
    held.add("A");
    expect(await bindAll([bind("A", "B"), bind("B", "C")])).toEqual([]);
    expect([...held].sort()).toEqual(["B", "C"]);
  });

  it("reports the jobs that still fail after the retry", async () => {
    expect(await bindAll([async () => true, async () => false])).toEqual([1]);
  });
});

describe("shortcutProblem", () => {
  it("rejects keys the browser or other apps use everywhere", () => {
    for (const k of ["CommandOrControl+C", "CommandOrControl+V", "CommandOrControl+W", "CommandOrControl+R", "Alt+F4", "Alt+Tab"]) expect(shortcutProblem(k), k).not.toBeNull();
    expect(shortcutProblem("CommandOrControl+Shift+I")).not.toBeNull();
  });

  it("accepts Ctrl or Command with Shift or Alt", () => {
    for (const k of ["CommandOrControl+Shift+A", "CommandOrControl+Alt+Space", "CommandOrControl+Alt+M"]) expect(shortcutProblem(k), k).toBeNull();
  });
});

describe("shortcutTaken", () => {
  const cur = { quickAddShortcut: "CommandOrControl+Shift+A", voiceShortcut: "CommandOrControl+Alt+Space", miniShortcut: "CommandOrControl+Alt+M" };

  it("refuses an accelerator another global shortcut already has, naming it", () => {
    expect(shortcutTaken(cur.miniShortcut, "quickAddShortcut", cur)).toBe("That shortcut already opens the mini window.");
    expect(shortcutTaken(cur.quickAddShortcut, "miniShortcut", cur)).toBe("That shortcut already opens quick add.");
    expect(shortcutTaken(cur.voiceShortcut, "miniShortcut", cur)).toBe("That shortcut is already push-to-talk.");
    expect(shortcutTaken(cur.miniShortcut, "voiceShortcut", cur)).toBe("That shortcut already opens the mini window.");
  });

  it("allows a free accelerator, and re-picking the shortcut's own", () => {
    expect(shortcutTaken("CommandOrControl+Alt+K", "miniShortcut", cur)).toBeNull();
    expect(shortcutTaken(cur.miniShortcut, "miniShortcut", cur)).toBeNull();
  });
});
