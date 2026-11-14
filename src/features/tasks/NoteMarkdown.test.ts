import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoteMarkdown } from "./NoteMarkdown";

const html = (md: string) => renderToStaticMarkup(createElement(NoteMarkdown, { children: md }));

describe("NoteMarkdown (D267)", () => {
  it("renders GFM tables", () => {
    const out = html("| Item | Qty |\n|---|---:|\n| Eggs | 12 |");
    expect(out).toContain("<table>");
    expect(out).toContain("<th>Item</th>");
    expect(out).toMatch(/<td[^>]*>12<\/td>/);
  });
  it("still renders no raw HTML", () => {
    const out = html('<img src=x onerror="alert(1)"> <b>bold</b>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
  });
});
