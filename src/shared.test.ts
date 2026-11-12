/*
 * The phone app (mobile/, PLAN D229) runs these folders as they are, so they must not reach for
 * desktop-only modules or browser globals. Desktop-only files in them are listed as exceptions.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error: plain .mjs script, no types
import { OUT, render } from "../scripts/mobile-migrations.mjs";
// @ts-expect-error: plain .mjs script, no types
import * as changelog from "../scripts/mobile-changelog.mjs";
// @ts-expect-error: plain .mjs script, no types
import * as tokens from "../scripts/mobile-tokens.mjs";

const SHARED = ["src/domain", "src/db", "src/stores", "src/lib/sync"];
/** Desktop-only: file dialogs and Rust commands (backup), the desktop UI state with Sonner and view transitions (ui). */
const DESKTOP_ONLY = new Set(["src/db/backup.ts", "src/stores/ui.ts"]);
const FORBIDDEN = [/from "@tauri-apps\//, /import\("@tauri-apps\//, /from "react-dom/, /from "sonner"/, /\bdocument\./, /\bwindow\./, /\blocalStorage\b/, /import\.meta\.env/, /from "\.\.\/(\.\.\/)?(features|components|lib\/(?!sync))/];

it("keeps shared code free of desktop-only imports and browser globals", () => {
  const offenders: string[] = [];
  for (const dir of SHARED)
    for (const name of readdirSync(dir)) {
      const file = `${dir}/${name}`;
      if (!/\.tsx?$/.test(name) || name.includes(".test.") || DESKTOP_ONLY.has(file)) continue;
      const text = readFileSync(join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const re of FORBIDDEN) if (re.test(text)) offenders.push(`${file}: ${re}`);
    }
  expect(offenders).toEqual([]);
});

it("bundles the current migrations for the phone (run scripts/mobile-migrations.mjs)", () => {
  expect(readFileSync(OUT, "utf8")).toBe(render());
});

it("gives the phone the current colour tokens (run scripts/mobile-tokens.mjs)", () => {
  expect(readFileSync(tokens.OUT, "utf8")).toBe(tokens.render());
});

it("bundles the current changelog for the phone (run scripts/mobile-changelog.mjs)", () => {
  expect(readFileSync(changelog.OUT, "utf8")).toBe(changelog.render());
});
