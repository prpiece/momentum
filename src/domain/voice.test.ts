import { describe, expect, it } from "vitest";
import { matchVoiceCommand, parseModelStatus } from "./voice";

describe("matchVoiceCommand", () => {
  it.each([
    ["Start focus.", "startFocus"],
    ["Um, start a focus session, please", "startFocus"],
    ["begin the pomodoro", "startFocus"],
    ["Stop the timer!", "stopFocus"],
    ["end focus", "stopFocus"],
    ["Open today", "openToday"],
    ["go to today", "openToday"],
    ["Show me the Eisenhower matrix.", "openMatrix"],
    ["hey Momentum, open my calendar", "openCalendar"],
    ["Let's open the calendar view", "openCalendar"],
  ] as const)("%s → %s", (text, cmd) => {
    expect(matchVoiceCommand(text)).toBe(cmd);
  });

  it.each(["Start focus on chemistry homework", "Buy milk tomorrow at 5pm", "today", "calendar", "", "open the fridge", "stop", "focus"])("leaves task text alone: %s", (text) => {
    expect(matchVoiceCommand(text)).toBeNull();
  });
});

describe("parseModelStatus", () => {
  it("accepts every state Rust sends", () => {
    expect(parseModelStatus({ state: "missing" })).toEqual({ state: "missing" });
    expect(parseModelStatus({ state: "downloading", received: 5, total: 10 })).toEqual({ state: "downloading", received: 5, total: 10 });
    expect(parseModelStatus({ state: "verifying" })).toEqual({ state: "verifying" });
    expect(parseModelStatus({ state: "ready" })).toEqual({ state: "ready" });
    expect(parseModelStatus({ state: "error", message: "x" })).toEqual({ state: "error", message: "x" });
  });

  it("turns anything else into an error", () => {
    expect(parseModelStatus(null).state).toBe("error");
    expect(parseModelStatus({ state: "downloading", received: "5" }).state).toBe("error");
    expect(parseModelStatus({ state: "nope" }).state).toBe("error");
  });
});
