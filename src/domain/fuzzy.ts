/*
 * Fuzzy matching for spoken names (D94, D95): a transcript spells "Family" as "familly" or "skool"
 * for School, so lists and tasks are matched by edit distance plus a sound-alike key.
 */

const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length];
}

const SOUND: Record<string, string> = {};
for (const [group, code] of [["bfpv", "1"], ["cgjkqsxz", "2"], ["dt", "3"], ["l", "4"], ["mn", "5"], ["r", "6"]]) for (const ch of group) SOUND[ch] = code;

/** Soundex-style key: consonant classes, vowels dropped, repeats collapsed (up to 6 chars). */
export function soundKey(s: string): string {
  const cs = letters(s);
  let prev = SOUND[cs.charAt(0)] ?? "";
  // The first letter is classed too, so "kemistry" and "Chemistry" agree.
  let key = prev || cs.charAt(0);
  for (const ch of cs.slice(1)) {
    const code = SOUND[ch];
    if (code && code !== prev) key += code;
    if (ch !== "h" && ch !== "w") prev = code ?? "";
  }
  return key.slice(0, 6);
}

/** 0..1: 1 for the same letters, at least 0.85 for sound-alikes, otherwise 1 - edit distance / length. */
export function similarity(a: string, b: string): number {
  const x = letters(a);
  const y = letters(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const edit = 1 - editDistance(x, y) / Math.max(x.length, y.length);
  return Math.min(x.length, y.length) >= 3 && soundKey(x) === soundKey(y) ? Math.max(edit, 0.85) : edit;
}

export const MATCH_THRESHOLD = 0.8;

/** The existing name closest to `query`, or null when none is close enough. */
export function bestName(query: string, names: readonly string[]): string | null {
  let best: string | null = null;
  let top = MATCH_THRESHOLD;
  for (const n of names) {
    const s = similarity(query, n);
    if (s > top || (s === top && best === null)) [best, top] = [n, s];
  }
  return best;
}

export type TaskCandidate = { id: string; title: string; today: boolean };

/** Mean best-word similarity of the query's words against the title's words. */
function phraseScore(query: string, title: string): number {
  const q = wordsOf(query);
  const t = wordsOf(title);
  if (!q.length || !t.length) return 0;
  return q.reduce((sum, w) => sum + Math.max(...t.map((x) => similarity(w, x))), 0) / q.length;
}

/**
 * Open tasks that fit a spoken description, best first (Today wins ties), at most three. A single
 * result means one clear match; several means the user has to pick.
 */
export function matchTasks<T extends TaskCandidate>(query: string, tasks: readonly T[]): T[] {
  const scored = tasks
    .map((t) => ({ t, s: phraseScore(query, t.title) }))
    .filter((x) => x.s >= MATCH_THRESHOLD)
    .map((x) => ({ t: x.t, s: x.s + (x.t.today ? 0.05 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  // ponytail: a 0.15 lead counts as "clear"; tune if confirmations feel too chatty.
  return scored.length > 1 && scored[0].s - scored[1].s >= 0.15 ? [scored[0].t] : scored.map((x) => x.t);
}
