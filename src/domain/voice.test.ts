import { describe, expect, it } from "vitest";
import { matchVoiceCommand, normalizeTranscript, parseModelStatus, parseVoicePopupEvent } from "./voice";

const view = (v: string) => ({ kind: "view", view: v });
const focus = (op: string) => ({ kind: "focus", op });

describe("matchVoiceCommand", () => {
  it.each([
    ["Start focus.", focus("start")],
    ["Um, start a focus session, please", focus("start")],
    ["begin the pomodoro", focus("start")],
    ["Stop the timer!", focus("stop")],
    ["end focus", focus("stop")],
    ["pause the timer", focus("pause")],
    ["resume focus", focus("resume")],
    ["skip focus", focus("skip")],
    ["skip the break", focus("skip")],
    ["start a break", focus("break")],
    ["take a break", focus("break")],
    ["Open today", view("today")],
    ["go to today", view("today")],
    ["Show me the Eisenhower matrix.", view("matrix")],
    ["hey Momentum, open my calendar", view("calendar")],
    ["Let's open the calendar view", view("calendar")],
    ["open inbox", view("inbox")],
    ["open upcoming", view("upcoming")],
    ["open habits", view("habits")],
    ["open focus", view("focus")],
    ["open stats", view("stats")],
    ["open settings", view("settings")],
    ["open the mini window", { kind: "mini", open: true }],
    ["show mini", { kind: "mini", open: true }],
    ["close the mini window", { kind: "mini", open: false }],
    ["hide mini", { kind: "mini", open: false }],
    ["open skool", { kind: "openList", name: "School" }],
    ["go to home chores", { kind: "openList", name: "Home Chores" }],
    ["complete chemistry homework", { kind: "complete", query: "chemistry homework" }],
    ["I finished the dentist", { kind: "complete", query: "dentist" }],
    ["done with laundry", { kind: "complete", query: "laundry" }],
    ["mark laundry as done", { kind: "complete", query: "laundry" }],
    ["tick off buy milk", { kind: "complete", query: "buy milk" }],
  ])("%s", (text, cmd) => {
    expect(matchVoiceCommand(text, ["School", "Home Chores", "Family"])).toEqual(cmd);
  });

  it.each(["Start focus on chemistry homework", "Buy milk tomorrow at 5pm", "today", "calendar", "", "open the fridge", "stop", "focus", "mark", "done", "open"])("leaves task text alone: %s", (text) => {
    expect(matchVoiceCommand(text, ["School"])).toBeNull();
  });
});

describe("normalizeTranscript", () => {
  it.each([
    ["call mom at five p m", "call mom at 5pm"],
    ["dinner at 5 p.m. tomorrow", "dinner at 5pm tomorrow"],
    ["lunch at 12:30 P.M.", "lunch at 12:30pm"],
    ["tag to do", "tag todo"],
    ["I have to do laundry", "I have to do laundry"],
  ])("%s", (text, out) => {
    expect(normalizeTranscript(text)).toBe(out);
  });
});

describe("parseVoicePopupEvent", () => {
  it("accepts well-formed events and rejects the rest", () => {
    expect(parseVoicePopupEvent({ kind: "text", text: "hi" })).toEqual({ kind: "text", text: "hi" });
    expect(parseVoicePopupEvent({ kind: "listening" })).toEqual({ kind: "listening" });
    const ok = { kind: "confirm", text: "done x", candidates: [{ id: "a", title: "X" }] };
    expect(parseVoicePopupEvent(ok)).toEqual(ok);
    expect(parseVoicePopupEvent({ kind: "confirm", text: "x", candidates: [] })).toBeNull();
    expect(parseVoicePopupEvent({ kind: "confirm", text: "x", candidates: [{ id: 1 }] })).toBeNull();
    expect(parseVoicePopupEvent({ kind: "text" })).toBeNull();
    expect(parseVoicePopupEvent({ kind: "nope" })).toBeNull();
    expect(parseVoicePopupEvent("listening")).toBeNull();
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
