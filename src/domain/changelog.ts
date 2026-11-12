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

/** A run of bullets under one of the section's own `###` headings (null before the first one, or when there are none). */
export type NewsGroup = { heading: string | null; items: NewsItem[] };

/** Splits a section into its `###` groups of top-level bullets. Continuation lines (like an indented screenshot) stay with their bullet. */
export function newsGroups(section: string): NewsGroup[] {
  const groups: { heading: string | null; raw: string[] }[] = [{ heading: null, raw: [] }];
  for (const line of section.split("\n")) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    const raw = groups[groups.length - 1].raw;
    if (h) groups.push({ heading: h[1], raw: [] });
    else if (line.startsWith("- ")) raw.push(line.slice(2));
    else if (raw.length && line.trim()) raw[raw.length - 1] += `\n${line.trim()}`;
  }
  return groups
    .filter((g) => g.raw.length)
    .map((g) => ({
      heading: g.heading,
      items: g.raw.map((r) => {
        const m = IMAGE.exec(r);
        return { text: r.replace(IMAGE, "").trim(), image: m ? { alt: m[1], src: m[2] } : null };
      }),
    }));
}

/** Every top-level bullet of a section, headings dropped. */
export const newsItems = (section: string): NewsItem[] => newsGroups(section).flatMap((g) => g.items);

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
