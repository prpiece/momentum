/** One "What's new" item: a top-level bullet of a CHANGELOG.md section, with its screenshot if it has one. */
export type NewsItem = { text: string; image: { src: string; alt: string } | null };

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/;

/** The body of the `## vX.Y.Z` section for `version` (no leading "v"), or null. */
export function changelogSection(md: string, version: string): string | null {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## v${version}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  return body || null;
}

/** Splits a section into its top-level bullets. Continuation lines (like an indented screenshot) stay with their bullet. */
export function newsItems(section: string): NewsItem[] {
  const items: string[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("- ")) items.push(line.slice(2));
    else if (items.length && line.trim()) items[items.length - 1] += `\n${line.trim()}`;
  }
  return items.map((raw) => {
    const m = IMAGE.exec(raw);
    return { text: raw.replace(IMAGE, "").trim(), image: m ? { alt: m[1], src: m[2] } : null };
  });
}

const parts = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
/** Semver-ish compare of `X.Y.Z` strings: negative when a < b. */
export const compareVersions = (a: string, b: string): number => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** Every section newer than `seen` up to `current`, newest first (D98). With no `seen`, just `current`. */
export function missedSections(md: string, seen: string | null, current: string): { version: string; body: string }[] {
  const versions = [...md.matchAll(/^## v(\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1]);
  return versions
    .filter((v) => compareVersions(v, current) <= 0 && (seen === null ? v === current : compareVersions(v, seen) > 0))
    .sort((a, b) => compareVersions(b, a))
    .flatMap((version) => {
      const body = changelogSection(md, version);
      return body ? [{ version, body }] : [];
    });
}
