// Fails when a Zustand selector builds a fresh array/object (infinite render loop in React 19).
// Allowed: selecting raw state and deriving with useMemo.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) && files.push(join(d, f))));
walk("src");
const read = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
// Every store hook, found from its `export const useX = create` (the phone shares these stores through @core).
const stores = [...new Set(files.flatMap((f) => [...read(f).matchAll(/export const (use\w+) = create/g)].map((m) => m[1])))];
// Matched against the whole file, so a selector split over several lines is caught too.
const BAD = new RegExp(
  String.raw`\b(?:${stores.join("|")})\(\(s\)\s*=>\s*(?:Object\.(?:values|keys|entries)|\[|\{|[^)]*\.(?:filter|map|sort|slice)\()`,
  "g",
);
// Optional directory argument: also lint it (used to test the check against a scratch file).
if (process.argv[2]) walk(process.argv[2]);
const hits = files.flatMap((f) => {
  const src = read(f);
  return [...src.matchAll(BAD)].map((m) => `${f}:${src.slice(0, m.index).split("\n").length}: ${m[0].split("\n")[0].trim()}`);
});
if (hits.length) {
  console.error("Zustand selectors must return stable references (derive with useMemo):\n" + hits.join("\n"));
  process.exit(1);
}
