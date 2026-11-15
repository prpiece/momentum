import { describe, expect, it } from "vitest";
import { shortcutProblem } from "./os";

describe("shortcutProblem", () => {
  it("rejects keys the browser or other apps use everywhere", () => {
    for (const k of ["CommandOrControl+C", "CommandOrControl+V", "CommandOrControl+W", "CommandOrControl+R", "Alt+F4", "Alt+Tab"]) expect(shortcutProblem(k), k).not.toBeNull();
    expect(shortcutProblem("CommandOrControl+Shift+I")).not.toBeNull();
  });

  it("accepts Ctrl or Command with Shift or Alt", () => {
    for (const k of ["CommandOrControl+Shift+A", "CommandOrControl+Alt+Space", "CommandOrControl+Alt+M"]) expect(shortcutProblem(k), k).toBeNull();
  });
});
