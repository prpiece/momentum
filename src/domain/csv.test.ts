import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b,1","say ""hi""\nthere"\r\nx,,y\r\n')).toEqual([
      ["a", "b,1", 'say "hi"\nthere'],
      ["x", "", "y"],
    ]);
  });
  it("keeps a last row without a newline and survives an unterminated quote", () => {
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(parseCsv('a,"b')).toEqual([["a", "b"]]);
    expect(parseCsv("")).toEqual([]);
  });
});
