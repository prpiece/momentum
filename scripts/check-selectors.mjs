// Fails when a Zustand selector builds a fresh array/object (infinite render loop in React 19).
// Allowed: selecting raw state and deriving with useMemo.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BAD = /use(Data|Settings|Ui|Habits|Calendar|Focus)\(\(s\)\s*=>\s*(Object\.(values|keys|entries)|\[|\{|[^)]*\.(filter|map|sort|slice)\()/;
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) && files.push(join(d, f))));
walk("src");
const hits = files.flatMap((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .map((line, i) => (BAD.test(line) ? `${f}:${i + 1}: ${line.trim()}` : null))
    .filter(Boolean),
);
if (hits.length) {
  console.error("Zustand selectors must return stable references (derive with useMemo):\n" + hits.join("\n"));
  process.exit(1);
}
