import { describe, expect, it } from "vitest";
import { DONE_EVENTS, FEATURES, GO, gettingStartedItems, markDone, PALETTE_IDS, searchFeatures, type GettingStarted } from "./features";

const commands = FEATURES.flatMap((f) => f.commands);

describe("feature registry", () => {
  it("documents every palette command exactly once", () => {
    const ids = commands.flatMap((c) => (c.kind === "palette" ? [c.id] : []));
    expect([...ids].sort()).toEqual([...PALETTE_IDS].sort());
  });

  it("documents every G key, and G M", () => {
    const documented = commands.flatMap((c) => (c.kind === "keys" ? c.keys.split(" / ") : []));
    for (const k of [...Object.keys(GO), "m"]) expect(documented.some((d) => d.includes(`G ${k.toUpperCase()}`)), `G ${k}`).toBe(true);
  });

  it("has unique ids, unique done events, and six core items", () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    const events = FEATURES.flatMap((f) => (f.done ? [f.done] : []));
    expect([...events].sort()).toEqual([...DONE_EVENTS].sort());
    expect(FEATURES.filter((f) => f.core)).toHaveLength(6);
    expect(FEATURES.filter((f) => f.core).every((f) => f.done)).toBe(true);
  });

  it("searches titles, how-tos and commands", () => {
    expect(searchFeatures("matrix").map((f) => f.id)).toContain("matrix-mode");
    expect(searchFeatures("ctrl z").map((f) => f.id)).toContain("undo");
    expect(searchFeatures("")).toHaveLength(FEATURES.length);
    expect(searchFeatures("zzzz")).toEqual([]);
  });
});

describe("getting started", () => {
  const gs: GettingStarted = { dismissed: false, done: [], seenVersion: null };

  it("ticks once per event", () => {
    const once = markDone(gs, "habit:checked");
    expect(once.done).toEqual(["habits"]);
    expect(markDone(once, "habit:checked")).toBe(once);
  });

  it("shows new entries to upgraders only, and brings a dismissed card back for them", () => {
    expect(gettingStartedItems(gs, "1.0.0").fresh).toEqual([]);
    const upgrader = gettingStartedItems({ ...gs, seenVersion: "0.9.1", dismissed: true }, "1.0.0");
    expect(upgrader.fresh.map((f) => f.id)).toContain("show-completed");
    expect(upgrader.visible).toBe(true);
    expect(upgrader.more.some((f) => upgrader.fresh.includes(f))).toBe(false);
    expect(gettingStartedItems({ ...gs, seenVersion: "1.0.0", dismissed: true }, "1.0.0").visible).toBe(false);
  });
});
