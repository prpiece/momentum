/*
 * The phone app (mobile/, PLAN D229) runs these folders as they are, so they must not reach for
 * desktop-only modules or browser globals. Desktop-only files in them are listed as exceptions.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
// @ts-expect-error: plain .mjs script, no types
import { OUT, render } from "../scripts/mobile-migrations.mjs";
// @ts-expect-error: plain .mjs script, no types
import * as changelog from "../scripts/mobile-changelog.mjs";
// @ts-expect-error: plain .mjs script, no types
import * as tokens from "../scripts/mobile-tokens.mjs";
// @ts-expect-error: plain .mjs script, no types
import { columns, SYNCED } from "../scripts/sync-triggers.mjs";

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

it("gives desktop and phone one version (PLAN D257)", () => {
  const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
  const versions = {
    "package.json": json("package.json").version,
    "src-tauri/tauri.conf.json": json("src-tauri/tauri.conf.json").version,
    "src-tauri/Cargo.toml": /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(readFileSync("src-tauri/Cargo.toml", "utf8"))?.[1],
    "mobile/app.json": json("mobile/app.json").expo.version,
  };
  expect(Object.values(versions).every((v) => typeof v === "string" && v === versions["package.json"]), JSON.stringify(versions)).toBe(true);
});

it("maps every synced column in shared code, so the phone never drops a field (PLAN D257)", () => {
  // Retired with the rewards (D256): still synced for v1.1 clients, read by nobody.
  const RETIRED = new Set(["rest_days", "celebrations"]);
  const db = new DatabaseSync(":memory:");
  const dir = "src-tauri/migrations";
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(`${dir}/${f}`, "utf8"));
  // ponytail: a column counts as mapped when shared code names it; a real read/write round trip per table would be stricter.
  const shared = SHARED.flatMap((d) => readdirSync(d).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test.")).map((n) => readFileSync(`${d}/${n}`, "utf8"))).join("\n");
  const ignored = Object.keys(SYNCED as Record<string, string>)
    .filter((t) => !RETIRED.has(t))
    .flatMap((t) => (columns(db, t) as string[]).filter((c) => !new RegExp(`\\b${c}\\b`).test(shared)).map((c) => `${t}.${c}`));
  expect(ignored).toEqual([]);
});

it("derives store build numbers from the shared version", async () => {
  // Node's own require: going through Vite would read mobile/tsconfig.json, which needs mobile's
  // node_modules (expo/tsconfig.base), and CI installs only the desktop's.
  const config = createRequire(import.meta.url)("../mobile/app.config.js");
  expect(config.versionCode("1.2.0")).toBe(10200);
  expect(config.versionCode("2.10.3")).toBe(21003);
  expect(() => config.versionCode("1.100.0")).toThrow();
  const out = config({ config: { version: "1.2.0", android: { package: "p" }, ios: {} } });
  expect([out.android.versionCode, out.ios.buildNumber, out.android.package]).toEqual([10200, "10200", "p"]);
});
