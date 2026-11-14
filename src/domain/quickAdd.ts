import { casual } from "chrono-node/en";
import { addMinutes } from "date-fns";
import { addDaysLocal, formatMinutes, relativeDayLabel, toLocalDate } from "./dates";
import { bestName } from "./fuzzy";
import type { LocalDate, Priority, Recurrence, Schedule, Waiting } from "./types";

export type ChipKind = "date" | "priority" | "tag" | "list" | "repeat" | "deadline" | "duration" | "someday" | "waiting";
/** `value` is the normalised token (the tag name), for chips whose text is spoken words. */
export type Chip = { kind: ChipKind; text: string; start: number; end: number; value?: string };

export type ParsedTask = {
  title: string;
  schedule: Schedule;
  priority: Priority | null;
  tags: string[];
  /** Raw `~name` token; the caller resolves it against existing lists. */
  listName: string | null;
  rule: string | null;
  /** `by fri` (D267). */
  deadline: LocalDate | null;
  /** `30m`, `1h30m`, `~2h`. */
  durationMin: number | null;
  /** `waiting @sam fri`: a person and the follow-up date. */
  waiting: Extract<Waiting, { kind: "person" }> | null;
  chips: Chip[];
};

/** A `waiting @name` without a date follows up this many days later. */
export const WAIT_DEFAULT_DAYS = 3;

export const DEFAULT_TASK_MINUTES = 60;

const PRIORITY_WORDS: Record<string, Priority> = {
  high: 3,
  h: 3,
  "3": 3,
  medium: 2,
  med: 2,
  m: 2,
  "2": 2,
  low: 1,
  l: 1,
  "1": 1,
  none: 0,
  "0": 0,
};

const DAYS: Record<string, string> = {
  mon: "MO",
  tue: "TU",
  tues: "TU",
  wed: "WE",
  thu: "TH",
  thur: "TH",
  thurs: "TH",
  fri: "FR",
  sat: "SA",
  sun: "SU",
};
const DAY_WORD = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?s?";
const dayCode = (w: string) => DAYS[w.toLowerCase().replace(/(day|nesday|sday|urday|rsday)?s?$/, "")];

type Match = { kind: ChipKind; start: number; end: number; value?: string; apply: (p: ParsedTask) => void };

function repeatMatches(text: string): Match[] {
  const out: Match[] = [];
  const add = (re: RegExp, rule: (m: RegExpExecArray) => string | null) => {
    for (const m of text.matchAll(re)) {
      const r = rule(m as RegExpExecArray);
      const start = m.index ?? 0;
      if (r) out.push({ kind: "repeat", start, end: start + m[0].length, apply: (p) => void (p.rule = r) });
    }
  };
  const UNIT: Record<string, string> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" };
  add(/\b(daily|weekly|monthly|yearly|annually)\b/gi, (m) => {
    const w = m[1].toLowerCase();
    return `FREQ=${w === "annually" ? "YEARLY" : w.toUpperCase()}`;
  });
  add(/\bevery\s+(weekday|weekdays|workday)\b/gi, () => "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  add(/\bevery\s+(other\s+|(\d+)\s+)?(day|week|month|year)s?\b/gi, (m) => {
    const interval = m[1]?.trim() === "other" ? 2 : m[2] ? Number(m[2]) : 1;
    return `FREQ=${UNIT[m[3].toLowerCase()]}${interval > 1 ? `;INTERVAL=${interval}` : ""}`;
  });
  add(new RegExp(`\\bevery\\s+(${DAY_WORD}(?:\\s*(?:,|and|&)\\s*${DAY_WORD})*)\\b`, "gi"), (m) => {
    const codes = m[1].split(/\s*(?:,|and|&)\s*/i).map(dayCode).filter(Boolean);
    return codes.length ? `FREQ=WEEKLY;BYDAY=${[...new Set(codes)].join(",")}` : null;
  });
  return out;
}

/** Keyword forms of the tokens (D89), so they can be spoken: "priority high", "high priority", "tag chem", "list School". A list must exist (fuzzily). */
function keywordMatches(text: string, listNames: readonly string[]): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(/(^|\s)(?:priority\s+(high|medium|med|low|none)|(high|medium|med|low)\s+priority)\b/gi)) {
    const p = PRIORITY_WORDS[(m[2] ?? m[3]).toLowerCase()];
    const start = (m.index ?? 0) + m[1].length;
    out.push({ kind: "priority", start, end: (m.index ?? 0) + m[0].length, apply: (r) => void (r.priority = p) });
  }
  for (const m of text.matchAll(/(^|\s)(?:hash\s?tag|tag)[\s:,]+([\p{L}\p{N}_\-/]+)/giu)) {
    const start = (m.index ?? 0) + m[1].length;
    const tag = m[2];
    out.push({ kind: "tag", value: tag, start, end: (m.index ?? 0) + m[0].length, apply: (r) => void r.tags.push(tag) });
  }
  for (const m of text.matchAll(/(^|\s)(?:in\s+)?list\s+/gi)) {
    const start = (m.index ?? 0) + m[1].length;
    const after = (m.index ?? 0) + m[0].length;
    const words = [...text.slice(after).matchAll(/[\p{L}\p{N}_-]+/gu)].slice(0, 4);
    // Longest phrase first, so "list Home Chores" isn't cut to "Home"; spoken names may be misspelt (D94).
    for (let k = words.length; k > 0; k--) {
      const last = words[k - 1];
      const end = after + (last.index ?? 0) + last[0].length;
      const name = bestName(text.slice(after + (words[0].index ?? 0), end), listNames);
      if (!name) continue;
      out.push({ kind: "list", start, end, apply: (r) => void (r.listName = name) });
      break;
    }
  }
  return out;
}

/** A date phrase starting at `from` (after optional spaces), as chrono reads it: its local date and end index. */
function dateAt(text: string, from: number, now: Date): { date: LocalDate; end: number } | null {
  const rest = text.slice(from);
  const lead = rest.length - rest.trimStart().length;
  const [r] = casual.parse(rest.trimStart(), now, { forwardDate: true });
  if (!r || r.index !== 0) return null;
  return { date: toLocalDate(r.start.date()), end: from + lead + r.text.length };
}

/** Planning tokens (D267): deadline, duration, someday, waiting. Run before the other passes so `~2h` isn't a list. */
function planningMatches(text: string, now: Date): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(/(^|\s)by(?=\s)/gi)) {
    const start = (m.index ?? 0) + m[1].length;
    const d = dateAt(text, start + 2, now);
    if (d) out.push({ kind: "deadline", start, end: d.end, apply: (p) => void (p.deadline = d.date) });
  }
  for (const m of text.matchAll(/(^|\s)~?(?:(\d{1,2})h(?:(\d{1,2})m)?|(\d{1,3})m(?:in)?)(?=\s|$|[,.;])/gi)) {
    const min = m[2] ? Number(m[2]) * 60 + Number(m[3] ?? 0) : Number(m[4]);
    const start = (m.index ?? 0) + m[1].length;
    if (min >= 1 && min <= 1440) out.push({ kind: "duration", start, end: (m.index ?? 0) + m[0].length, apply: (p) => void (p.durationMin = min) });
  }
  for (const m of text.matchAll(/(^|\s)someday\b/gi)) {
    const start = (m.index ?? 0) + m[1].length;
    out.push({ kind: "someday", start, end: start + 7, apply: (p) => void (p.schedule = { kind: "someday" }) });
  }
  for (const m of text.matchAll(/(^|\s)waiting\s+(?:for\s+|on\s+)?@([\p{L}\p{N}_.\-]+)/giu)) {
    const start = (m.index ?? 0) + m[1].length;
    const afterName = (m.index ?? 0) + m[0].length;
    const d = dateAt(text, afterName, now);
    const who = m[2];
    const followUp = d?.date ?? addDaysLocal(toLocalDate(now), WAIT_DEFAULT_DAYS);
    out.push({ kind: "waiting", value: who, start, end: d?.end ?? afterName, apply: (p) => void (p.waiting = { kind: "person", who, followUp }) });
  }
  return out;
}

function tokenMatches(text: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(/(^|\s)!(\w+)/g)) {
    const p = PRIORITY_WORDS[m[2].toLowerCase()];
    if (p === undefined) continue;
    const start = (m.index ?? 0) + m[1].length;
    out.push({ kind: "priority", start, end: start + m[2].length + 1, apply: (r) => void (r.priority = p) });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_\-/]+)/gu)) {
    const start = (m.index ?? 0) + m[1].length;
    const tag = m[2];
    out.push({ kind: "tag", value: tag, start, end: start + tag.length + 1, apply: (r) => void r.tags.push(tag) });
  }
  for (const m of text.matchAll(/(^|\s)~([\p{L}\p{N}_\-]+)/gu)) {
    const start = (m.index ?? 0) + m[1].length;
    const name = m[2];
    out.push({ kind: "list", start, end: start + name.length + 1, apply: (r) => void (r.listName = name) });
  }
  return out;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

/** Blank out matched spans so later passes (chrono) don't re-read them. Keeps indexes stable. */
const mask = (text: string, spans: { start: number; end: number }[]) =>
  spans.reduce((t, s) => t.slice(0, s.start) + " ".repeat(s.end - s.start) + t.slice(s.end), text);

/** Where an entry's text came from (D90): keyword tokens only count when spoken. */
export type InputOrigin = "typed" | "spoken";

/**
 * Quick-add grammar: free text plus `!high` / `!2` priority, `#tag`, `~List` (spoken entries also take
 * their keyword forms, matched against `listNames` for lists), repeat phrases ("every Mon and Wed",
 * "daily", "every 2 weeks") and any date/time chrono understands.
 */
export function parseQuickAdd(input: string, now: Date, enabled = true, listNames: readonly string[] = [], origin: InputOrigin = "typed"): ParsedTask {
  const result: ParsedTask = {
    title: input.trim(),
    schedule: { kind: "none" },
    priority: null,
    tags: [],
    listName: null,
    rule: null,
    deadline: null,
    durationMin: null,
    waiting: null,
    chips: [],
  };
  if (!enabled) return result;

  const matches: Match[] = [];
  for (const m of [...planningMatches(input, now), ...tokenMatches(input), ...(origin === "spoken" ? keywordMatches(input, listNames) : []), ...repeatMatches(input)]) {
    if (!matches.some((x) => overlaps(x, m))) matches.push(m);
  }

  const [date] = casual.parse(mask(input, matches), now, { forwardDate: true });
  if (date) {
    const start = date.index;
    const end = start + date.text.length;
    const from = date.start.date();
    const hasTime = date.start.isCertain("hour");
    const until = date.end?.date();
    matches.push({
      kind: "date",
      start,
      end,
      apply: (p) => {
        if (p.schedule.kind === "someday") return; // `someday` wins over a stray date word
        p.schedule = hasTime
          ? {
              kind: "timed",
              start: from.toISOString(),
              end: (until && until > from ? until : addMinutes(from, DEFAULT_TASK_MINUTES)).toISOString(),
            }
          : { kind: "day", date: toLocalDate(from) };
      },
    });
  }

  matches.sort((a, b) => a.start - b.start);
  // Priority and list are single-valued and a tag is only worth one chip: the first of each wins,
  // repeats ("high priority, high priority", "#a #A") are still blanked out of the title.
  const seen = new Set<string>();
  for (const m of matches) {
    const key = m.kind === "tag" ? `tag:${m.value?.toLowerCase()}` : m.kind === "priority" || m.kind === "list" || m.kind === "deadline" || m.kind === "duration" || m.kind === "waiting" ? m.kind : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    m.apply(result);
    result.chips.push({ kind: m.kind, text: input.slice(m.start, m.end), start: m.start, end: m.end, ...(m.value ? { value: m.value } : {}) });
  }
  // A repeat with no explicit date starts today; rrule then picks the first matching day.
  if (result.rule && result.schedule.kind === "none") result.schedule = { kind: "day", date: toLocalDate(now) };
  if (result.schedule.kind === "someday") result.rule = null;

  const title = mask(input, matches)
    .replace(/\s+(on|at|by|for)\s*$/i, "")
    .replace(/\s+/g, " ")
    // Spoken text leaves punctuation where tokens were ("tomorrow, priority high."): drop the orphans.
    .replace(/\s+([,.;:!?])(?=\s|$)/g, "$1")
    .replace(/([,;:])(?:[\s,;:.]*[,;:.])+/g, "$1")
    .replace(/^[\s,;:.]+|[\s,;:.]+$/g, "")
    .trim();
  result.title = title || input.trim();
  return result;
}

/** Sets a priority or list token in quick-add text: replaces the existing chip's span, or appends one (D89). */
export function withToken(text: string, chips: readonly Chip[], kind: "priority" | "list", token: string): string {
  const c = chips.find((x) => x.kind === kind);
  return c ? text.slice(0, c.start) + token + text.slice(c.end) : `${text.trimEnd()} ${token}`.trimStart();
}

/** Removes a priority or list token (D91's "None"), closing the gap it leaves. */
export function withoutToken(text: string, chips: readonly Chip[], kind: "priority" | "list"): string {
  const c = chips.find((x) => x.kind === kind);
  return c ? `${text.slice(0, c.start)} ${text.slice(c.end)}`.replace(/\s+/g, " ").trim() : text;
}

/**
 * What a parsed entry sets on the new task once a view's context (column, quadrant, calendar slot, list)
 * has had its say (D220): the context supplies defaults, any token the user typed wins, tags merge.
 */
export function withDefaults(
  p: ParsedTask,
  d: { schedule?: Schedule; priority?: Priority; tags?: readonly string[] },
): {
  schedule?: Schedule;
  priority?: Priority;
  tags: string[];
  recurrence: Recurrence | null;
  deadline?: LocalDate;
  durationMin?: number;
  waiting?: Waiting;
} {
  // A repeat's implied "today" is not a date the user typed, so it never beats the context's date.
  const typedDate = p.chips.some((c) => c.kind === "date" || c.kind === "someday");
  const schedule = typedDate || !d.schedule ? p.schedule : d.schedule;
  const priority = p.priority ?? d.priority;
  return {
    ...(schedule.kind !== "none" ? { schedule } : {}),
    ...(priority !== undefined ? { priority } : {}),
    tags: [...new Set([...(d.tags ?? []), ...p.tags])],
    recurrence: p.rule ? { rule: p.rule, exdates: [] } : null,
    ...(p.deadline ? { deadline: p.deadline } : {}),
    ...(p.durationMin ? { durationMin: p.durationMin } : {}),
    ...(p.waiting ? { waiting: p.waiting } : {}),
  };
}

/** Chip text for the planning tokens (D267), shared by both quick adds; null for other kinds. */
export function planningChipLabel(kind: ChipKind, p: ParsedTask, today: LocalDate): string | null {
  if (kind === "deadline" && p.deadline) return `by ${relativeDayLabel(p.deadline, today)}`;
  if (kind === "duration" && p.durationMin) return formatMinutes(p.durationMin);
  if (kind === "someday") return "Someday";
  if (kind === "waiting" && p.waiting) return `Waiting for ${p.waiting.who} · ${relativeDayLabel(p.waiting.followUp, today)}`;
  return null;
}
