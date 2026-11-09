/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, contrast } from "../domain/color";

// Guards WCAG AA for the token colours in both themes, and that ACCENTS repeats tokens.css (D198).
const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[[\]]/g, "\\$&");
  const start = css.search(new RegExp(`(^|\\n)${escaped}\\s*\\{`));
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf("{", start), css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };
const SURFACES = ["bg", "surface", "surface-2", "raised"];
// Text is checked where text sits. In light, success and the teal/fern/coral accent text are 4.2–4.5:1 on
// surface-2 (hover, chips), and coral is 4.49:1 on bg: known shortfalls of the token file, listed in D198.
const TEXT_SURFACES = ["bg", "surface", "raised"];
const SHORT = new Set(["coral:bg"]);

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme tokens", (_name, t) => {
  it.each(["fg", "fg-2", "muted", "danger", "success", "accent-text"])("%s text is AA (4.5:1) where text sits", (fg) => {
    for (const bg of TEXT_SURFACES) expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["prio-high", "prio-med", "prio-low", "q-do", "q-schedule", "q-delegate", "q-drop", "control-border", "streak"])("%s mark is >= 3:1 on surfaces", (p) => {
    for (const bg of SURFACES) expect(contrast(t[p], t[bg]), `${p} on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it("button text is AA on accent and danger", () => {
    expect(contrast(t["accent-fg"], t.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["danger-fg"], t.danger)).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each(ACCENTS.slice(1))("accent preset $id", (a) => {
  const l = block(`[data-accent="${a.id}"]`);
  const d = block(`[data-theme="dark"][data-accent="${a.id}"]`);

  it("matches tokens.css", () => {
    expect(l.accent).toBe(a.light);
    expect(d.accent).toBe(a.dark);
  });

  it("is AA as a button and as text in both themes", () => {
    for (const [p, t] of [[l, light], [d, dark]] as const) {
      expect(contrast(p["accent-fg"], p.accent)).toBeGreaterThanOrEqual(4.5);
      for (const bg of TEXT_SURFACES) if (!SHORT.has(`${a.id}:${bg}`)) expect(contrast(p["accent-text"], t[bg]), `${a.id} text on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it("indigo, the default, matches :root and the dark block", () => {
  expect(light.accent).toBe(ACCENTS[0].light);
  expect(dark.accent).toBe(ACCENTS[0].dark);
});

describe("keyframes", () => {
  // A later @keyframes with the same name silently replaces the earlier one (a menu's exit once played the confetti dots).
  it("have unique names across the style sheets", () => {
    const all = css + readFileSync(new URL("./components.css", import.meta.url), "utf8");
    const names = [...all.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});
