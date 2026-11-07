import { describe, expect, it } from "vitest";
import { complete, suggest, tokenAt } from "./autocomplete";

describe("tokenAt", () => {
  it("finds the tag or list token at the caret", () => {
    expect(tokenAt("Study #sch", 10)).toEqual({ sigil: "#", query: "sch", start: 6, end: 10 });
    expect(tokenAt("Essay ~", 7)).toEqual({ sigil: "~", query: "", start: 6, end: 7 });
    expect(tokenAt("#sch tomorrow", 2)).toEqual({ sigil: "#", query: "s", start: 0, end: 4 });
  });

  it("ignores sigils inside words and caret outside tokens", () => {
    expect(tokenAt("C#", 2)).toBeNull();
    expect(tokenAt("a~b", 3)).toBeNull();
    expect(tokenAt("#school now", 11)).toBeNull();
  });
});

describe("suggest", () => {
  const names = ["school", "Deep-work", "preschool", "Work"];
  it("ranks prefix matches first, case and spaces ignored", () => {
    expect(suggest("sch", names)).toEqual(["school", "preschool"]);
    expect(suggest("", names)).toEqual(names);
    expect(suggest("historyes", ["History essay"])).toEqual(["History essay"]);
  });

  it("drops a name that is already typed in full", () => {
    expect(suggest("work", names)).toEqual(["Deep-work"]);
  });
});

describe("complete", () => {
  it("replaces the whole token and leaves the caret after one space", () => {
    const t = tokenAt("Read #sc tomorrow", 8);
    expect(t && complete("Read #sc tomorrow", t, "school")).toEqual({ text: "Read #school tomorrow", caret: 13 });
  });

  it("writes list names without spaces", () => {
    const t = tokenAt("Draft ~hi", 9);
    expect(t && complete("Draft ~hi", t, "History essay")).toEqual({ text: "Draft ~Historyessay ", caret: 20 });
  });
});
