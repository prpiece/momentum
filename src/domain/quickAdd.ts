import { type Chrono, GB, casual } from "chrono-node/en";
import { add as addDur, addDays, addMinutes, endOfMonth, startOfDay } from "date-fns";
import { addDaysLocal, dateOrder, formatMinutes, relativeDayLabel, toLocalDate } from "./dates";
import { bestName, nameKey } from "./fuzzy";
import type { LocalDate, Priority, Recurrence, Reminder, Schedule, Task, Waiting } from "./types";

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

/** Characters a `#tag` / `~List` / `@name` may contain; shared with autocomplete so both read a token the same way (QA-10, QA-11). */
export const TOKEN_CHARS = String.raw`\p{L}\p{N}\p{M}_\-/`;
/** A token word: chars, optionally dotted ("v1.2"). Not followed by more word chars or `'`/`+` ("#don't", "#c++" are not tags). */
const TOKEN_WORD = String.raw`([${TOKEN_CHARS}]+(?:\.[${TOKEN_CHARS}]+)*)(?![${TOKEN_CHARS}'’+])`;

/** Chrono with a bare hour 1-7 read as the afternoon ("at 5", "9 to 5"), as people mean it (QA-02, QA-03). */
const afternoon = (chrono: Chrono) => void chrono.refiners.unshift({
  refine: (_ctx, results) => {
    for (const r of results) {
      if (/\b(?:in|within|ago|later|from|hours?|mins?|minutes?)\b/i.test(r.text)) continue; // relative, not a clock time
      const pm = (c: typeof r.start) => {
        const h = c.get("hour");
        if (h !== null && c.isCertain("hour") && !c.isCertain("meridiem") && h >= 1 && h <= 7) c.assign("hour", h + 12);
      };
      pm(r.start);
      // "9 to 5": an end before its start is the same day's afternoon.
      if (r.end) {
        const sh = r.start.get("hour") ?? 0;
        const eh = r.end.get("hour");
        if (eh !== null && r.end.isCertain("hour") && !r.end.isCertain("meridiem") && eh < 12 && eh <= sh) r.end.assign("hour", eh + 12);
        else pm(r.end);
      }
    }
    return results;
  },
});
const chronoMdy = casual.clone();
const chronoDmy = GB.clone(); // "3/4" is 3 April (FEAT-12)
afternoon(chronoMdy);
afternoon(chronoDmy);
const CHRONO_OPTS = { forwardDate: true };
/** Words that are ordinary language as often as dates: only a date when introduced by one of these (QA-08). */
const AMBIGUOUS_DAY = /^(?:sat|sun|mon|wed|mar|may|march|now)$/i;
const DATE_INTRO = /\b(?:on|next|this|last|by|every|until|till|from|before|after|since)\s+$/i;

/**
 * Date phrases in `text`, as chrono reads them. A phrase with no time of day is read from the start of
 * today, so "fri" on a Friday afternoon is today (chrono otherwise compares its implied noon to `now`, QA-01).
 * `strict` drops lone ambiguous words and stems of possessives/compounds ("tomorrow's", "tomorrow-ish").
 */
function parseDates(text: string, now: Date, strict = true) {
  const chrono = dateOrder() === "dmy" ? chronoDmy : chronoMdy;
  const midnight = new Map(chrono.parse(text, startOfDay(now), CHRONO_OPTS).map((r) => [r.index, r]));
  return chrono
    .parse(text, now, CHRONO_OPTS)
    .map((r) => (r.start.isCertain("hour") ? r : (midnight.get(r.index) ?? r)))
    .filter((r) => {
      if (!strict) return true;
      if (/^(?:['’]s\b|-\p{L})/u.test(text.slice(r.index + r.text.length))) return false;
      return !(AMBIGUOUS_DAY.test(r.text.trim()) && !DATE_INTRO.test(text.slice(0, r.index)));
    });
}

type Match = { kind: ChipKind; start: number; end: number; value?: string; apply: (p: ParsedTask) => void };

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1 };
const ordinal = (w: string) => ORDINALS[w.toLowerCase()] ?? parseInt(w, 10);

function repeatMatches(text: string, now: Date): Match[] {
  const out: Match[] = [];
  // `until <date>` / `x5` / `5 times` end a repeat; they are read first and appended to whichever rule matches.
  let ending: string | ((rule: string) => string) = "";
  const add = (re: RegExp, rule: (m: RegExpExecArray) => string | null) => {
    for (const m of text.matchAll(re)) {
      const r = rule(m as RegExpExecArray);
      const start = m.index ?? 0;
      if (r) out.push({ kind: "repeat", start, end: start + m[0].length, apply: (p) => void (p.rule = r + (typeof ending === "function" ? ending(r) : ending)) });
    }
  };
  add(/\b(?:bi-?weekly|fortnightly|every\s+fortnight)\b/gi, () => "FREQ=WEEKLY;INTERVAL=2");
  add(new RegExp(String.raw`\b(?:every\s+)?(first|second|third|fourth|fifth|last|\d(?:st|nd|rd|th))\s+(${DAY_WORD})\b(\s+of\s+(?:the\s+|every\s+)?month)?`, "gi"), (m) => {
    const n = ordinal(m[1]);
    if (!/^every/i.test(m[0]) && !m[3]) return null;
    return n && n >= -1 && n <= 5 ? `FREQ=MONTHLY;BYDAY=${n}${dayCode(m[2])}` : null;
  });
  add(/\b(?:monthly|every\s+month)\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b|\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b/gi, (m) => {
    const d = Number(m[1] ?? m[2]);
    return d >= 1 && d <= 31 ? `FREQ=MONTHLY;BYMONTHDAY=${d}` : null;
  });
  add(/\bevery\s+weekend\b/gi, () => "FREQ=WEEKLY;BYDAY=SA,SU");
  const UNIT: Record<string, string> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" };
  add(/\b(daily|weekly|monthly|yearly|annually)\b/gi, (m) => {
    const w = m[1].toLowerCase();
    return `FREQ=${w === "annually" ? "YEARLY" : w.toUpperCase()}`;
  });
  add(/\bevery\s+(weekday|weekdays|workday|weeknight|weeknights)\b/gi, () => "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  add(/\bevery\s+(other\s+|(\d+)\s+)?(day|week|month|year)s?\b/gi, (m) => {
    const interval = m[1]?.trim() === "other" ? 2 : m[2] ? Number(m[2]) : 1;
    return `FREQ=${UNIT[m[3].toLowerCase()]}${interval > 1 ? `;INTERVAL=${interval}` : ""}`;
  });
  add(new RegExp(`\\bevery\\s+(${DAY_WORD}(?:\\s*(?:,|and|&)\\s*${DAY_WORD})*)\\b`, "gi"), (m) => {
    const codes = m[1].split(/\s*(?:,|and|&)\s*/i).map(dayCode).filter(Boolean);
    return codes.length ? `FREQ=WEEKLY;BYDAY=${[...new Set(codes)].join(",")}` : null;
  });
  if (out.length) {
    for (const m of text.matchAll(/\b(?:until|till|through)\s+/gi)) {
      const d = dateAt(text, (m.index ?? 0) + m[0].length - 1, now);
      if (!d || ending) continue;
      ending = `;UNTIL=${d.date.replace(/-/g, "")}T235959Z`;
      out.push({ kind: "repeat", start: m.index ?? 0, end: d.end, apply: () => undefined });
    }
    for (const m of text.matchAll(/(?<=^|\s)(?:x(\d{1,3})|(\d{1,3})\s+times)\b/gi)) {
      if (ending) break;
      ending = `;COUNT=${m[1] ?? m[2]}`;
      out.push({ kind: "repeat", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, apply: () => undefined });
    }
    // "for 5 weeks": that many occurrences when the span is in the repeat's own unit, otherwise an end date.
    for (const m of text.matchAll(/\bfor\s+(\d{1,3})\s+(day|week|month|year)s?\b/gi)) {
      if (ending) break;
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      ending = (rule) => {
        if (rule.includes(`FREQ=${FREQ_OF[unit]}`)) {
          const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1);
          const perPeriod = unit === "week" ? (/BYDAY=([A-Z,]+)/.exec(rule)?.[1].split(",").length ?? 1) : 1;
          return `;COUNT=${Math.ceil(n / interval) * perPeriod}`;
        }
        return `;UNTIL=${toLocalDate(addDur(now, { [`${unit}s`]: n })).replace(/-/g, "")}T235959Z`;
      };
      out.push({ kind: "repeat", start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, apply: () => undefined });
    }
  }
  return out;
}
const FREQ_OF: Record<string, string> = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" };

/** `eod` / `eow` / `eom` and "end of day/week/month": a day, with no time (QA-18). eow is Friday, the end of the working week. */
function endMatches(text: string, now: Date): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(/(?<=^|\s)(eod|eow|eom|end of (?:the )?(?:day|week))(?=\s|$|[,.;])/gi)) {
    const w = m[1].toLowerCase();
    const d = w.endsWith("d") || w.endsWith("day") ? now : w === "eom" ? endOfMonth(now) : addDays(now, (5 - now.getDay() + 7) % 7);
    const date = toLocalDate(d);
    const start = m.index ?? 0;
    out.push({ kind: "date", start, end: start + m[0].length, apply: (p) => void (p.schedule.kind === "someday" || (p.schedule = { kind: "day", date })) });
  }
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
  for (const m of text.matchAll(new RegExp(String.raw`(^|\s)(?:hash\s?tag|tag)[\s:,]+([${TOKEN_CHARS}]+)`, 'giu'))) {
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
  const [r] = parseDates(rest.trimStart(), now, false);
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
  for (const m of text.matchAll(/(^|[\s(\[])(?<!\b(?:in|within)\s)~?(?:(\d{1,2}(?:\.\d+)?)\s?(?:h|hrs?|hours?)(?:\s?(\d{1,3})\s?(?:m|mins?|minutes?))?|(\d{1,4})\s?(?:m|mins?|minutes?))(?=\s|$|[,.;)\]])/gi)) {
    const min = m[2] ? Math.round(Number(m[2]) * 60) + Number(m[3] ?? 0) : Number(m[4]);
    const start = (m.index ?? 0) + m[1].length;
    if (min >= 1 && min <= 1440) out.push({ kind: "duration", start, end: (m.index ?? 0) + m[0].length, apply: (p) => void (p.durationMin = min) });
  }
  for (const m of text.matchAll(/(^|\s)someday\b/gi)) {
    const start = (m.index ?? 0) + m[1].length;
    out.push({ kind: "someday", start, end: start + 7, apply: (p) => void (p.schedule = { kind: "someday" }) });
  }
  for (const m of text.matchAll(/(^|\s)waiting\s+(?:for\s+|on\s+)?@([\p{L}\p{N}\p{M}_.\-]+)/giu)) {
    const start = (m.index ?? 0) + m[1].length;
    const afterName = (m.index ?? 0) + m[0].length;
    const d = dateAt(text, afterName, now);
    const who = m[2];
    const followUp = d?.date ?? addDaysLocal(toLocalDate(now), WAIT_DEFAULT_DAYS);
    out.push({ kind: "waiting", value: who, start, end: d?.end ?? afterName, apply: (p) => void (p.waiting = { kind: "person", who, followUp }) });
  }
  return out;
}

function tokenMatches(text: string, listNames: readonly string[]): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(/(^|\s)!(\w+)/g)) {
    const p = PRIORITY_WORDS[m[2].toLowerCase()];
    if (p === undefined) continue;
    const start = (m.index ?? 0) + m[1].length;
    out.push({ kind: "priority", start, end: start + m[2].length + 1, apply: (r) => void (r.priority = p) });
  }
  for (const m of text.matchAll(new RegExp(String.raw`(^|\s)#${TOKEN_WORD}`, "gu"))) {
    const start = (m.index ?? 0) + m[1].length;
    const tag = m[2];
    out.push({ kind: "tag", value: tag, start, end: start + tag.length + 1, apply: (r) => void r.tags.push(tag) });
  }
  for (const m of text.matchAll(new RegExp(String.raw`(^|\s)~${TOKEN_WORD}`, "gu"))) {
    const start = (m.index ?? 0) + m[1].length;
    let name = m[2];
    let end = start + name.length + 1;
    // "~Home Chores": the longest run of following words that names an existing list (QA-15).
    const words: { text: string; end: number }[] = [];
    for (const w of text.slice(end).matchAll(new RegExp(String.raw`\s+[${TOKEN_CHARS}]+`, "gu"))) {
      if ((w.index ?? 0) !== (words.length ? words[words.length - 1].end - end : 0)) break;
      words.push({ text: w[0], end: end + (w.index ?? 0) + w[0].length });
      if (words.length === 3) break;
    }
    for (let k = words.length; k > 0; k--) {
      const full = name + words.slice(0, k).map((w) => w.text).join("");
      if (listNames.some((n) => nameKey(n) === nameKey(full))) {
        name = full;
        end = words[k - 1].end;
        break;
      }
    }
    out.push({ kind: "list", start, end, apply: (r) => void (r.listName = name) });
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
  for (const m of [...planningMatches(input, now), ...tokenMatches(input, listNames), ...endMatches(input, now), ...(origin === "spoken" ? keywordMatches(input, listNames) : []), ...repeatMatches(input, now)]) {
    if (!matches.some((x) => overlaps(x, m))) matches.push(m);
  }

  let explicitEnd = false;
  const [date] = matches.some((m) => m.kind === "date") ? [] : parseDates(mask(input, matches), now);
  if (date) {
    const start = date.index;
    const end = start + date.text.length;
    const from = date.start.date();
    const hasTime = date.start.isCertain("hour");
    const until = date.end?.date();
    explicitEnd = !!until && until > from;
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
  // A duration token sets the end of a timed task that has no `until` (`5pm 30m`).
  if (result.schedule.kind === "timed" && !explicitEnd && result.durationMin)
    result.schedule = { ...result.schedule, end: addMinutes(new Date(result.schedule.start), result.durationMin).toISOString() };
  // A repeat with no explicit date starts today; rrule then picks the first matching day.
  if (result.rule && result.schedule.kind === "none") result.schedule = { kind: "day", date: toLocalDate(now) };
  if (result.schedule.kind === "someday") result.rule = null;

  const title = mask(input, matches)
    .replace(/\(\s*\)|\[\s*\]|["“”]\s*["“”]/g, " ")
    .replace(/\s+(on|at|by|for|due)\s*$/i, "")
    .replace(/^\s*remind me (?:to|about|that)\s+/i, "")
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
    recurrence: p.rule ? { rule: p.rule, exdates: [], tz: null } : null,
    ...(p.deadline ? { deadline: p.deadline } : {}),
    ...(p.durationMin ? { durationMin: p.durationMin } : {}),
    ...(p.waiting ? { waiting: p.waiting } : {}),
  };
}

/**
 * What typing tokens over an existing task's title changes (FEAT-07): the parsed title and only the fields a token set.
 * `tagIds` and `listId` resolve the spoken names; a `~list` that doesn't exist is ignored. A subtask keeps its parent's list.
 */
export function tokenPatch(
  p: ParsedTask,
  task: { tags: readonly string[]; parentId: string | null },
  resolve: { tagIds: (names: string[]) => string[]; listId: (name: string) => string | undefined },
): Partial<Task> {
  const listId = !task.parentId && p.listName ? resolve.listId(p.listName) : undefined;
  return {
    title: p.title,
    ...(p.schedule.kind !== "none" ? { schedule: p.schedule } : {}),
    ...(p.rule ? { recurrence: { rule: p.rule, exdates: [], tz: null } } : {}),
    ...(p.priority !== null ? { priority: p.priority } : {}),
    ...(p.tags.length ? { tags: [...new Set([...task.tags, ...resolve.tagIds(p.tags)])] } : {}),
    ...(listId ? { listId } : {}),
    ...(p.deadline ? { deadline: p.deadline } : {}),
    ...(p.durationMin ? { durationMin: p.durationMin } : {}),
    ...(p.waiting ? { waiting: p.waiting } : {}),
  };
}

/** The default reminder (D338) for a new timed task that has none of its own; day tasks and untimed ones get nothing. */
export function defaultReminders(schedule: Schedule, minutes: number | null): Reminder[] {
  return schedule.kind === "timed" && minutes !== null ? [{ kind: "before", minutes }] : [];
}

/** Chip text for the planning tokens (D267), shared by both quick adds; null for other kinds. */
export function planningChipLabel(kind: ChipKind, p: ParsedTask, today: LocalDate): string | null {
  if (kind === "deadline" && p.deadline) return `by ${relativeDayLabel(p.deadline, today)}`;
  if (kind === "duration" && p.durationMin) return formatMinutes(p.durationMin);
  if (kind === "someday") return "Someday";
  if (kind === "waiting" && p.waiting) return `Waiting for ${p.waiting.who} · ${relativeDayLabel(p.waiting.followUp, today)}`;
  return null;
}
