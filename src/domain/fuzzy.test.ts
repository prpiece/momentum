import { describe, expect, it } from "vitest";
import { bestName, matchTasks, similarity, soundKey } from "./fuzzy";

describe("similarity", () => {
  it("is 1 for the same letters, ignoring case, spaces and punctuation", () => {
    expect(similarity("Home Chores", "home-chores")).toBe(1);
  });
  it("tolerates small spelling slips and sound-alikes", () => {
    expect(similarity("familly", "Family")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("skool", "School")).toBeGreaterThanOrEqual(0.8);
    expect(similarity("kemistry", "Chemistry")).toBeGreaterThanOrEqual(0.8);
  });
  it("keeps different words apart", () => {
    expect(similarity("work", "Home")).toBeLessThan(0.8);
    expect(similarity("mom", "Family")).toBeLessThan(0.8);
  });
  it("sound keys ignore vowels and doubled letters", () => {
    expect(soundKey("Robert")).toBe(soundKey("Rupert"));
  });
});

describe("bestName", () => {
  const names = ["School", "Home Chores", "Home", "Family"];
  it("returns the closest name above the threshold", () => {
    expect(bestName("skool", names)).toBe("School");
    expect(bestName("home chores", names)).toBe("Home Chores");
  });
  it("returns null below it", () => {
    expect(bestName("fridge", names)).toBeNull();
  });
});

describe("matchTasks", () => {
  const t = (id: string, title: string, today = false) => ({ id, title, today });
  it("finds one clear match", () => {
    expect(matchTasks("chemistry homework", [t("a", "Do chemistry homework"), t("b", "Buy milk")]).map((x) => x.id)).toEqual(["a"]);
  });
  it("returns nothing when no task fits", () => {
    expect(matchTasks("dentist", [t("a", "Buy milk")])).toEqual([]);
  });
  it("lists up to three when ambiguous, Today first", () => {
    const got = matchTasks("buy milk", [t("a", "Buy milk"), t("b", "Buy milk", true), t("c", "Buy milk"), t("d", "Buy milk")]);
    expect(got.map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("tolerates a mis-heard word", () => {
    expect(matchTasks("call the dentst", [t("a", "Call the dentist")]).map((x) => x.id)).toEqual(["a"]);
  });
});
