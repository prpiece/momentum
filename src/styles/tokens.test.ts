/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast } from "../domain/color";

// Guards WCAG AA for the hand-picked token colors in both themes.
const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme tokens", (_name, t) => {
  it.each(["fg", "fg-2", "fg-muted", "danger", "success"])("%s text is AA (4.5:1) on every surface", (fg) => {
    for (const bg of ["bg", "surface", "surface-2"]) expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["p1", "p2", "p3"])("priority mark %s is >= 3:1 on surfaces", (p) => {
    for (const bg of ["bg", "surface", "surface-2"]) expect(contrast(t[p], t[bg])).toBeGreaterThanOrEqual(3);
  });
});
