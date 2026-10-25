import { casual } from "chrono-node/en";
import { addMinutes } from "date-fns";
import { toLocalDate } from "./dates";
import type { Priority, Schedule } from "./types";

export type ChipKind = "date" | "priority" | "tag" | "list" | "repeat";
export type Chip = { kind: ChipKind; text: string; start: number; end: number };

export type ParsedTask = {
  title: string;
  schedule: Schedule;
  priority: Priority | null;
  tags: string[];
  /** Raw `~name` token; the caller resolves it against existing lists. */
  listName: string | null;
  rule: string | null;
  chips: Chip[];
};

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

type Match = { kind: ChipKind; start: number; end: number; apply: (p: ParsedTask) => void };

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
    out.push({ kind: "tag", start, end: start + tag.length + 1, apply: (r) => void r.tags.push(tag) });
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

/**
 * Quick-add grammar: free text plus `!high` / `!2` priority, `#tag`, `~List`,
 * repeat phrases ("every Mon and Wed", "daily", "every 2 weeks") and any date/time chrono understands.
 */
export function parseQuickAdd(input: string, now: Date, enabled = true): ParsedTask {
  const result: ParsedTask = {
    title: input.trim(),
    schedule: { kind: "none" },
    priority: null,
    tags: [],
    listName: null,
    rule: null,
    chips: [],
  };
  if (!enabled) return result;

  const matches: Match[] = [];
  for (const m of [...tokenMatches(input), ...repeatMatches(input)]) {
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
  for (const m of matches) {
    m.apply(result);
    result.chips.push({ kind: m.kind, text: input.slice(m.start, m.end), start: m.start, end: m.end });
  }
  // A repeat with no explicit date starts today; rrule then picks the first matching day.
  if (result.rule && result.schedule.kind === "none") result.schedule = { kind: "day", date: toLocalDate(now) };

  const title = mask(input, matches)
    .replace(/\s+(on|at|by|for)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  result.title = title || input.trim();
  return result;
}
