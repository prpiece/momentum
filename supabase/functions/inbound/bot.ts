/*
 * The chat and webhook commands (PLAN D265, D288), shared by every adapter. Text in, private
 * reply text out; every write lands in the account's own records through `server_write`, so its
 * devices pull it like any synced change. Runs in Deno (the Edge Function) and in Node (the
 * server tests).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as core from "./core.bundle.js";
import type { LocalDate, Schedule, Task } from "./core.bundle.js";

export type Source = "discord" | "slack" | "telegram";
/** What a connection may do (D288): add tasks only, or every command. */
export type Permission = "add" | "full";
export type Link = { id: string; account_id: string; source: Source; external_id: string; permission?: Permission };
export type Chat = { source: Source; externalId: string; label: string | null; reply: Record<string, unknown> };

// ---------- time zones ----------
// The domain code reads wall-clock time from the runtime's zone. A "wall" Date carries the
// account's wall clock in the runtime's zone, so the shared rules see the user's day.

function wallFields(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return [n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")] as const;
}
export const toWall = (at: Date, tz: string): Date => new Date(...wallFields(at, tz));
export function fromWall(w: Date, tz: string): Date {
  const guess = Date.UTC(w.getFullYear(), w.getMonth(), w.getDate(), w.getHours(), w.getMinutes(), w.getSeconds());
  const offset = (t: number) => Date.UTC(...wallFields(new Date(t), tz)) - t;
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}
const mapTimed = (s: Schedule, f: (iso: string) => string): Schedule =>
  s.kind === "timed" ? { kind: "timed", start: f(s.start), end: f(s.end) } : s;
const shiftTask = (t: Task, tz: string): Task => ({ ...t, schedule: mapTimed(t.schedule, (i) => toWall(new Date(i), tz).toISOString()) });
const unshiftTask = (t: Task, tz: string): Task => ({ ...t, schedule: mapTimed(t.schedule, (i) => fromWall(new Date(i), tz).toISOString()) });
export const validZone = (tz: unknown): string => {
  if (typeof tz !== "string") return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
};

// ---------- the account's records ----------

type Rec = Record<string, unknown> & { id: string };

async function records(db: SupabaseClient, account: string, tbl: string, withDeleted = false): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("sync_rows").select("id, data").eq("owner_id", account).eq("tbl", tbl);
    if (!withDeleted) q = q.is("data->>deleted_at", null);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...data.map((r) => ({ ...(r.data as Record<string, unknown>), id: r.id as string })));
    if (data.length < 1000) return out;
  }
}

async function write(db: SupabaseClient, account: string, tbl: string, id: string, fields: Record<string, unknown>) {
  const { error } = await db.rpc("server_write", { p_account: account, p_tbl: tbl, p_id: id, p_fields: fields });
  if (error) throw error;
}

const iso = () => new Date().toISOString();

// ---------- commands ----------

export const HELP = [
  "add <text> — add a task (same tokens as the app: tomorrow 5pm, 30m, by fri, !high, #tag, ~List)",
  "today · week · overdue · inbox · waiting · trash — list tasks, numbered",
  "list <name> · search <text>",
  "view N — a task's details and its full id",
  "update N <tokens> — change the date, deadline, duration, priority, list or tags, e.g. update 2 fri 5pm !high #work",
  "done N · reopen N · snooze N <when> · move N <list> · deadline N <date>",
  "delete N — move one task to the Trash (delete N with subtasks if it has any) · restore N",
  "habits · habit <name> — today's habits, or check one in",
  "send @friend <text> — send a task to a friend",
  "focus — your focus status",
  "digest on <time> · digest off — a daily list at that time",
  "unlink — disconnect this chat",
  "N is a number from your last list, or a task's full id.",
].join("\n");

export const UNLINKED =
  "This chat isn't linked to Momentum yet. In the app open Settings → Connections, choose Link a chat, then send: link <code>";
export const SERVER_PROBLEM = "Momentum's server had a problem reading your account. Try again in a moment.";

export const ADD_ONLY_REPLY = "This connection can only add tasks. To use every command, give it full access in Settings → Connections.";

const COMMANDS = ["add", "today", "week", "overdue", "inbox", "list", "search", "waiting", "view", "update", "done", "reopen",
  "snooze", "move", "deadline", "delete", "restore", "trash", "habit", "habits", "send", "focus", "digest", "help", "unlink",
  "link", "start"] as const;
type Command = (typeof COMMANDS)[number];
type Parsed = { cmd: Command; arg: string };

/** What an add-only connection may run. */
const ADD_ONLY: ReadonlySet<Command> = new Set(["add", "help", "start", "link", "unlink"]);
/** Commands about the chat itself, which the webhook doesn't have. */
const CHAT_ONLY: ReadonlySet<Command> = new Set(["link", "unlink", "digest"]);

/** Splits "done 2" into a command and its argument; anything else is `null` (Telegram: a plain message adds it). */
export function parseCommand(text: string): Parsed | null {
  const t = text.trim().replace(/^\/(task|momentum)(@\w+)?\s*/i, "").replace(/^\//, "");
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t);
  if (!m) return null;
  const word = m[1].toLowerCase().replace(/@\w+$/, "");
  return (COMMANDS as readonly string[]).includes(word) ? { cmd: word as Command, arg: m[2].trim() } : null;
}

type Item = { id: string; key: string | null };
/** Where a connection's last numbered listing lives, for an hour. */
type Listings = { load(): Promise<Item[] | null>; save(items: Item[]): Promise<void> };
type Ctx = { db: SupabaseClient; link: Link; tz: string; permission: Permission; via: "chat" | "webhook"; listings: Listings };

const fresh = (at: unknown) => typeof at === "string" && Date.parse(at) > Date.now() - 3_600_000;

const chatListings = (db: SupabaseClient, linkId: string): Listings => ({
  async load() {
    const { data } = await db.from("chat_listings").select("items, at").eq("link_id", linkId).maybeSingle();
    return data && fresh(data.at) ? (data.items as Item[]) : null;
  },
  async save(items) {
    await db.from("chat_listings").upsert({ link_id: linkId, items, at: iso() });
  },
});

const hookListings = (db: SupabaseClient, account: string): Listings => ({
  async load() {
    const { data } = await db.from("webhooks").select("listing, listing_at").eq("account_id", account).maybeSingle();
    return data && fresh(data.listing_at) ? (data.listing as Item[]) : null;
  },
  async save(items) {
    await db.from("webhooks").update({ listing: items, listing_at: iso() }).eq("account_id", account);
  },
});

async function tasksOf(c: Ctx) {
  const tasks = (await records(c.db, c.link.account_id, "tasks")).map((r) => core.parseTask(r)).filter((t): t is Task => !!t && !t.deletedAt);
  const vms = tasks.map((t) => core.toVM(shiftTask(t, c.tz))).filter((v): v is NonNullable<typeof v> => !!v);
  return { tasks, vms };
}

async function listsOf(c: Ctx) {
  const lists = await records(c.db, c.link.account_id, "lists");
  return lists.map((l) => ({ id: l.id, name: typeof l.name === "string" ? l.name : "" }));
}

const today = (tz: string): LocalDate => core.toLocalDate(toWall(new Date(), tz));

type Shown = { task: Task; key: string | null; date: string | null };

/** Numbers the tasks for `done N` and friends, remembering them for an hour. */
async function listing(c: Ctx, heading: string, vms: Shown[], empty: string, keepOrder = false) {
  const ordered = keepOrder ? vms : [...vms].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || b.task.priority - a.task.priority);
  const shown = ordered.slice(0, 50);
  await c.listings.save(shown.map((v) => ({ id: v.task.id, key: v.key })));
  if (!shown.length) return empty;
  return [heading, ...shown.map((v, i) => `${i + 1}. ${v.task.title}${v.task.status === "done" && !v.task.deletedAt ? " (done)" : ""}`)].join("\n");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The task an argument names: a number from the last listing, or a full task id. */
async function pick(c: Ctx, arg: string): Promise<{ item: Item; rest: string; index: number | null; items: Item[] | null } | string> {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(arg);
  if (m && UUID.test(m[1])) return { item: { id: m[1].toLowerCase(), key: null }, rest: m[2].trim(), index: null, items: null };
  if (!m || !/^\d+$/.test(m[1])) return "Which one? Use the number from your last list (e.g. done 2) or the task's full id.";
  const items = await c.listings.load();
  const index = Number(m[1]) - 1;
  const item = items?.[index];
  if (!item) return "That number isn't in your last list (lists last an hour). Ask for today, week or inbox again.";
  return { item, rest: m[2].trim(), index, items };
}

/** The task a number points at; for a repeating task, its occurrence detached as a task of its own. */
async function target(c: Ctx, item: Item): Promise<{ task: Task; series: Task | null; all: Task[] } | null> {
  const { tasks } = await tasksOf(c);
  const t = tasks.find((x) => x.id === item.id);
  if (!t) return null;
  if (!t.recurrence) return { task: t, series: null, all: tasks };
  const key = item.key ?? core.effective(shiftTask(t, c.tz))?.key;
  if (!key) return null;
  const { series, single } = core.detachOccurrence(shiftTask(t, c.tz), key, crypto.randomUUID(), iso());
  const next = core.effective(series) ? series : { ...series, deletedAt: iso() };
  return { task: unshiftTask(single, c.tz), series: unshiftTask(next, c.tz), all: tasks };
}

async function save(c: Ctx, ...tasks: Task[]) {
  for (const t of tasks) await write(c.db, c.link.account_id, "tasks", t.id, core.taskToRow(t));
}

async function log(c: Ctx, taskId: string, kind: string, detail = "") {
  const id = crypto.randomUUID().replace(/-/g, "");
  await write(c.db, c.link.account_id, "task_activity", id, { id, task_id: taskId, at: iso(), kind, detail, deleted_at: null });
}

function descendants(all: Task[], id: string, depth = 0): Task[] {
  if (depth > 10) return [];
  const kids = all.filter((t) => t.parentId === id);
  return kids.flatMap((k) => [k, ...descendants(all, k.id, depth + 1)]);
}

/** Tag names to ids, creating the missing tags (as the app's quick add does). */
async function tagIds(c: Ctx, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const tags = await records(c.db, c.link.account_id, "tags");
  const ids: string[] = [];
  for (const name of names) {
    const hit = tags.find((t) => typeof t.name === "string" && t.name.toLowerCase() === name.toLowerCase());
    if (hit) {
      ids.push(hit.id);
      continue;
    }
    const id = crypto.randomUUID();
    await write(c.db, c.link.account_id, "tags", id, { id, name, color: null, deleted_at: null });
    tags.push({ id, name });
    ids.push(id);
  }
  return ids;
}

const findList = (lists: { id: string; name: string }[], name: string) => {
  const hit = core.bestName(name, lists.map((l) => l.name));
  return lists.find((l) => l.name === hit);
};

async function add(c: Ctx, text: string): Promise<string> {
  if (!text) return "What should I add? e.g. add buy milk tomorrow";
  const lists = await listsOf(c);
  const p = core.parseQuickAdd(text, toWall(new Date(), c.tz), true, lists.map((l) => l.name));
  const list = p.listName ? findList(lists, p.listName) : undefined;
  const schedule = mapTimed(p.schedule, (i) => fromWall(new Date(i), c.tz).toISOString());
  const at = iso();
  const task: Task = {
    id: crypto.randomUUID(), title: p.title.slice(0, 500), description: "", listId: list?.id ?? core.INBOX_ID, parentId: null, sectionId: null,
    status: "open", priority: p.priority ?? 0, schedule, deadline: p.deadline, durationMin: p.durationMin, waiting: p.waiting,
    recurrence: p.rule ? { rule: p.rule, exdates: [] } : null, recurrenceParentId: null,
    tags: await tagIds(c, p.tags), checklist: [], reminders: [], sortOrder: -Date.now() / 1000, pinned: false,
    createdAt: at, updatedAt: at, completedAt: null, deletedAt: null,
  };
  await save(c, task);
  return `Added "${task.title}"${list ? ` to ${list.name}` : ""}.`;
}

async function show(c: Ctx, cmd: "today" | "week" | "overdue" | "inbox" | "waiting"): Promise<string> {
  const { vms } = await tasksOf(c);
  const d = today(c.tz);
  const open = vms.filter((v) => v.task.status === "open");
  switch (cmd) {
    case "today":
      return listing(c, "Today", open.filter((v) => core.inSmartList("today", v, d)), "Nothing due today.");
    case "week": {
      const end = core.addDaysLocal(d, 6);
      return listing(c, "Next 7 days", open.filter((v) => v.date !== null && v.date <= end), "Nothing in the next 7 days.");
    }
    case "overdue":
      return listing(c, "Overdue", open.filter((v) => core.isOverdue(v, d)), "Nothing overdue.");
    case "inbox":
      return listing(c, "Inbox", open.filter((v) => core.inSmartList("inbox", v, d)), "Your Inbox is empty.");
    case "waiting": {
      // Waiting for (D267): `waiting` is JSON text or null (v1.3 handoff).
      const rows = new Map((await records(c.db, c.link.account_id, "tasks")).map((r) => [r.id, r]));
      const w = open.filter((v) => { const x = rows.get(v.task.id)?.waiting; return x !== undefined && x !== null && x !== "" && x !== "null"; });
      return listing(c, "Waiting for", w, "Nothing waiting.");
    }
  }
}

async function inList(c: Ctx, name: string): Promise<string> {
  if (!name) return "Which list? e.g. list Work";
  const list = findList(await listsOf(c), name);
  if (!list) return `No list called "${name}".`;
  const { vms } = await tasksOf(c);
  return listing(c, list.name, vms.filter((v) => v.task.status === "open" && v.task.listId === list.id), `${list.name} has no open tasks.`);
}

/** Open matches first, then done ones (so a task done by mistake can be found and reopened). */
async function search(c: Ctx, q: string): Promise<string> {
  if (!q) return "Search for what? e.g. search invoice";
  const { vms } = await tasksOf(c);
  const hits = vms
    .map((v) => ({ v, s: core.matchScore(v.task.title, q) }))
    .filter((x): x is { v: (typeof vms)[number]; s: number } => x.s !== null)
    .sort((a, b) => Number(a.v.task.status === "done") - Number(b.v.task.status === "done") || a.s - b.s)
    .slice(0, 20)
    .map((x) => x.v);
  return listing(c, `Matching "${q}"`, hits, `Nothing matches "${q}".`, true);
}

const PRIORITY = ["", "low", "medium", "high"];
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

async function view(c: Ctx, arg: string): Promise<string> {
  const p = await pick(c, arg);
  if (typeof p === "string") return p;
  const { tasks } = await tasksOf(c);
  const t = tasks.find((x) => x.id === p.item.id);
  if (!t) return "That task is gone.";
  const lists = await listsOf(c);
  const tags = new Map((await records(c.db, c.link.account_id, "tags")).map((x) => [x.id, String(x.name ?? "")]));
  const kids = tasks.filter((x) => x.parentId === t.id);
  const s = shiftTask(t, c.tz).schedule;
  const lines = [
    t.title,
    `List: ${t.listId === core.INBOX_ID ? "Inbox" : lists.find((l) => l.id === t.listId)?.name ?? "?"}`,
    t.status === "done" ? "Done" : "",
    s.kind === "day" ? `Date: ${s.date}` : s.kind === "timed"
      ? `Date: ${core.toLocalDate(new Date(s.start))} ${clock(new Date(s.start))}–${clock(new Date(s.end))}` : "",
    t.recurrence ? "Repeats" : "",
    t.deadline ? `Deadline: ${t.deadline}` : "",
    t.durationMin ? `Duration: ${minutes(t.durationMin)}` : "",
    t.priority ? `Priority: ${PRIORITY[t.priority]}` : "",
    t.tags.length ? `Tags: ${t.tags.map((id) => `#${tags.get(id) ?? "?"}`).join(" ")}` : "",
    kids.length ? `Subtasks: ${kids.filter((k) => k.status === "done").length} of ${kids.length} done` : "",
    t.description ? `Notes: ${t.description.slice(0, 300)}${t.description.length > 300 ? "…" : ""}` : "",
    `id: ${t.id}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** A new date or time for a task, keeping its time of day when only the day changes. */
function reschedule(task: Task, when: Schedule, tz: string): Task {
  if (when.kind === "none") return task;
  const shifted = shiftTask(task, tz);
  const next: Schedule = when.kind === "timed" || when.kind === "someday"
    ? when
    : core.moveToDate(shifted.schedule.kind === "none" ? { kind: "day", date: when.date } : shifted.schedule, when.date);
  return unshiftTask({ ...shifted, schedule: next }, tz);
}

async function change(c: Ctx, cmd: "done" | "reopen" | "snooze" | "move" | "deadline" | "update", arg: string): Promise<string> {
  const p = await pick(c, arg);
  if (typeof p === "string") return p;
  const found = await target(c, p.item);
  if (!found) return "That task is gone.";
  const { task, series, all } = found;
  const at = iso();
  const extra = series ? [series] : [];
  if (cmd === "done") {
    const kids = series ? [] : descendants(all, task.id).filter((k) => k.status === "open").map((k) => ({ ...k, status: "done" as const, completedAt: at, updatedAt: at }));
    await save(c, ...extra, { ...task, status: "done", completedAt: at, updatedAt: at }, ...kids);
    await log(c, task.id, "completed");
    // The listing's number now means the completed occurrence, so `reopen N` undoes it.
    if (series && p.items && p.index !== null) {
      p.items[p.index] = { id: task.id, key: null };
      await c.listings.save(p.items);
    }
    return `Done: "${task.title}".`;
  }
  if (cmd === "reopen") {
    if (task.status !== "done") return `"${task.title}" is already open.`;
    await save(c, { ...task, status: "open", completedAt: null, updatedAt: at });
    await log(c, task.id, "reopened");
    return `Reopened "${task.title}".`;
  }
  const lists = await listsOf(c);
  if (cmd === "move") {
    const list = p.rest ? findList(lists, p.rest) : undefined;
    if (!p.rest || !list) return p.rest ? `No list called "${p.rest}".` : "Move it where? e.g. move 2 Work";
    const kids = descendants(all, task.id).map((k) => ({ ...k, listId: list.id, sectionId: null, updatedAt: at }));
    await save(c, ...extra, { ...task, listId: list.id, sectionId: null, updatedAt: at }, ...kids);
    await log(c, task.id, "moved", list.name);
    return `Moved "${task.title}" to ${list.name}.`;
  }
  const when = core.parseQuickAdd(p.rest, toWall(new Date(), c.tz), true, lists.map((l) => l.name));
  if (cmd === "update") {
    const list = when.listName ? findList(lists, when.listName) : undefined;
    if (when.listName && !list) return `No list called "${when.listName}".`;
    const changes = [
      when.schedule.kind !== "none" && "date",
      when.deadline && "deadline",
      when.durationMin && "duration",
      when.priority !== null && "priority",
      list && "list",
      when.tags.length > 0 && "tags",
    ].filter((x): x is string => !!x);
    if (!changes.length) return "Nothing to change in that. Use the app's tokens, e.g. update 2 fri 5pm 30m by dec 24 !high #work ~Home";
    let next: Task = { ...reschedule(task, when.schedule, c.tz), updatedAt: at };
    if (when.deadline) next.deadline = when.deadline;
    if (when.durationMin) next.durationMin = when.durationMin;
    if (when.priority !== null) next.priority = when.priority;
    if (when.tags.length) next.tags = [...new Set([...next.tags, ...(await tagIds(c, when.tags))])];
    const kids = list ? descendants(all, task.id).map((k) => ({ ...k, listId: list.id, sectionId: null, updatedAt: at })) : [];
    if (list) next = { ...next, listId: list.id, sectionId: null };
    await save(c, ...extra, next, ...kids);
    await log(c, task.id, "edited", changes.join(", "));
    return `Updated "${task.title}": ${changes.join(", ")}.`;
  }
  if (when.schedule.kind === "none") return cmd === "snooze" ? "Snooze to when? e.g. snooze 2 tomorrow 9am" : "Which date? e.g. deadline 2 friday";
  if (cmd === "deadline") {
    const s = when.schedule;
    const date = s.kind === "day" ? s.date : s.kind === "timed" ? core.toLocalDate(new Date(s.start)) : null;
    if (!date) return "Which date? e.g. deadline 2 friday";
    await save(c, ...extra, { ...task, deadline: date, updatedAt: at });
    return `Deadline for "${task.title}": ${date}.`;
  }
  await save(c, ...extra, { ...reschedule(task, when.schedule, c.tz), updatedAt: at });
  return `Snoozed "${task.title}".`;
}

/** Moves one task (and, only when asked, its subtasks) to the Trash (D287). Never more than one. */
async function remove(c: Ctx, arg: string): Promise<string> {
  const m = /^(\S+)(\s+with\s+subtasks)?$/i.exec(arg.trim());
  if (!m) return "Delete one task at a time: delete N (a number from your last list or the task's full id), or delete N with subtasks.";
  const p = await pick(c, m[1]);
  if (typeof p === "string") return p;
  const { tasks } = await tasksOf(c);
  const t = tasks.find((x) => x.id === p.item.id);
  if (!t) return "That task is gone.";
  const kids = descendants(tasks, t.id);
  if (kids.length && !m[2]) {
    return `"${t.title}" has ${kids.length} subtask${kids.length === 1 ? "" : "s"}. To move them to the Trash too, send: delete ${m[1]} with subtasks`;
  }
  const at = iso();
  for (const x of [...kids].reverse().concat(t)) await write(c.db, c.link.account_id, "tasks", x.id, { deleted_at: at, updated_at: at });
  const also = kids.length ? ` with ${kids.length} subtask${kids.length === 1 ? "" : "s"} (${kids.map((k) => `"${k.title}"`).join(", ")})` : "";
  return `Moved "${t.title}"${also} to the Trash. To undo: restore ${t.id}`;
}

async function trashed(c: Ctx): Promise<Task[]> {
  return (await records(c.db, c.link.account_id, "tasks", true)).map((r) => core.parseTask(r)).filter((t): t is Task => !!t);
}

async function trashList(c: Ctx): Promise<string> {
  const gone = (await trashed(c)).filter((t) => t.deletedAt).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  return listing(c, "Trash", gone.map((task) => ({ task, key: null, date: null })), "The Trash is empty.", true);
}

/** Brings a trashed task back, with its trashed parents and the subtasks deleted with it. */
async function restore(c: Ctx, arg: string): Promise<string> {
  const p = await pick(c, arg.trim());
  if (typeof p === "string") return p;
  if (p.rest) return "Restore one task at a time: restore N.";
  const all = await trashed(c);
  const t = all.find((x) => x.id === p.item.id);
  if (!t) return "That task isn't in the Trash any more.";
  if (!t.deletedAt) return `"${t.title}" isn't in the Trash.`;
  const parents: Task[] = [];
  for (let up = all.find((x) => x.id === t.parentId); up && parents.length < 10; up = all.find((x) => x.id === up!.parentId)) {
    if (up.deletedAt) parents.unshift(up);
  }
  const kids = descendants(all, t.id).filter((k) => k.deletedAt === t.deletedAt);
  const at = iso();
  for (const x of [...parents, t, ...kids]) await write(c.db, c.link.account_id, "tasks", x.id, { deleted_at: null, updated_at: at });
  return `Restored "${t.title}"${parents.length ? ` and its parent "${parents.at(-1)!.title}"` : ""}.`;
}

type HabitRec = Rec & { name?: unknown; goal?: unknown; archived?: unknown };
const goalOf = (h: HabitRec): { kind?: string; target?: number; cap?: number; unit?: string } => {
  try {
    return JSON.parse(String(h.goal ?? "{}"));
  } catch {
    return {}; // the app's default: once a day
  }
};

async function habitsOf(c: Ctx) {
  return ((await records(c.db, c.link.account_id, "habits")) as HabitRec[]).filter((h) => !Number(h.archived));
}

async function todayValue(c: Ctx, habitId: string, d: LocalDate): Promise<number> {
  const { data } = await c.db.from("sync_rows").select("data").eq("owner_id", c.link.account_id).eq("tbl", "habit_checkins").eq("id", `${habitId}|${d}`).maybeSingle();
  const cur = data?.data as { value?: number; deleted_at?: string | null } | undefined;
  return cur && !cur.deleted_at ? Number(cur.value ?? 0) : 0;
}

async function habit(c: Ctx, name: string): Promise<string> {
  if (!name) return "Which habit? e.g. habit read";
  const habits = await habitsOf(c);
  const hit = core.bestName(name, habits.map((h) => String(h.name ?? "")));
  const h = habits.find((x) => x.name === hit);
  if (!h) return `No habit called "${name}".`;
  const d = today(c.tz);
  if ((goalOf(h).kind ?? "once") === "once" && (await todayValue(c, h.id, d)) >= 1) return `"${h.name}" is already checked in today.`;
  await write(c.db, c.link.account_id, "habit_checkins", `${h.id}|${d}`, { habit_id: h.id, date: d, _delta: 1, deleted_at: null });
  return `Checked in "${h.name}".`;
}

/** Today's value for each habit. ponytail: today only; weekly-total habits show today's part, not the week's. */
async function habitList(c: Ctx): Promise<string> {
  const habits = await habitsOf(c);
  if (!habits.length) return "You have no habits yet.";
  const d = today(c.tz);
  const lines = await Promise.all(habits.map(async (h) => {
    const v = await todayValue(c, h.id, d);
    const g = goalOf(h);
    const unit = g.unit ? ` ${g.unit}` : "";
    const state = g.kind === "count" || g.kind === "amount" ? `${v} of ${g.target ?? 1}${unit}`
      : g.kind === "limit" ? `${v}${unit} (max ${g.cap ?? 0})`
      : g.kind === "quit" ? (v ? "slipped today" : "clear today")
      : v ? "done" : "not yet";
    return `${h.name}: ${state}`;
  }));
  return ["Habits today", ...lines].join("\n");
}

async function sendTo(c: Ctx, arg: string): Promise<string> {
  const m = /^@?([a-z0-9_]{3,20})\s+([\s\S]+)$/i.exec(arg);
  if (!m) return "Send to whom? e.g. send @sam review the draft friday";
  const { data: friend } = await c.db.from("profiles").select("id, handle").eq("handle", m[1].toLowerCase()).maybeSingle();
  const p = core.parseQuickAdd(m[2], toWall(new Date(), c.tz));
  if (!friend) return `@${m[1]} isn't your friend on Momentum.`;
  const { error } = await c.db.rpc("send_task", {
    p_sender: c.link.account_id, p_recipient: friend.id,
    p_payload: { title: p.title, priority: p.priority ?? 0, due_date: p.schedule.kind === "day" ? p.schedule.date : null },
  });
  if (error) return error.message.includes("too_many") ? "You've sent a lot of tasks today. Try again tomorrow." : `@${m[1]} isn't your friend on Momentum.`;
  return `Sent "${p.title}" to @${friend.handle}. You'll see when they accept it.`;
}

async function focus(c: Ctx): Promise<string> {
  const { data } = await c.db.from("focus_status").select("ends_at").eq("account_id", c.link.account_id).maybeSingle();
  const ends = data?.ends_at ? new Date(data.ends_at as string) : null;
  if (!ends || ends.getTime() <= Date.now()) return "You're not focusing right now.";
  return `Focusing until ${clock(toWall(ends, c.tz))}.`;
}

/** "7", "7:30", "7pm", "19:00" → "HH:MM". */
export function parseClock(s: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}

async function digest(c: Ctx, arg: string): Promise<string> {
  const [onOff, ...rest] = arg.split(/\s+/);
  if (onOff?.toLowerCase() === "off") {
    await c.db.from("chat_links").update({ digest_time: null }).eq("id", c.link.id);
    return "Digest off.";
  }
  const t = onOff?.toLowerCase() === "on" ? parseClock(rest.join(" ") || "8:00") : null;
  if (!t) return "Use digest on 8:00 (your time zone) or digest off.";
  await c.db.from("chat_links").update({ digest_time: t, digest_sent: null }).eq("id", c.link.id);
  return `Digest on: every day at ${t}, your time.`;
}

/** The Digest text for an account: today's tasks, numbered like a `today` listing. */
export async function digestText(db: SupabaseClient, link: Link): Promise<string> {
  const c = await context(db, link, "chat");
  return `Good morning. ${await show(c, "today")}`;
}

async function context(db: SupabaseClient, link: Link, via: Ctx["via"]): Promise<Ctx> {
  const { data } = await db.from("profiles").select("time_zone").eq("id", link.account_id).maybeSingle();
  const listings = via === "chat" ? chatListings(db, link.id) : hookListings(db, link.account_id);
  return { db, link, tz: validZone(data?.time_zone), permission: link.permission ?? "full", via, listings };
}

/** Runs one command for a linked chat or the webhook, within the connection's permission. */
async function run(c: Ctx, { cmd, arg }: Parsed): Promise<string> {
  if (c.permission === "add" && !ADD_ONLY.has(cmd)) return ADD_ONLY_REPLY;
  if (c.via === "webhook" && CHAT_ONLY.has(cmd)) return "That command only works in a chat.";
  switch (cmd) {
    case "add": return add(c, arg);
    case "today": case "week": case "overdue": case "inbox": case "waiting": return show(c, cmd);
    case "list": return inList(c, arg);
    case "search": return search(c, arg);
    case "view": return view(c, arg);
    case "done": case "reopen": case "snooze": case "move": case "deadline": case "update": return change(c, cmd, arg);
    case "delete": return remove(c, arg);
    case "restore": return restore(c, arg);
    case "trash": return trashList(c);
    case "habit": return habit(c, arg);
    case "habits": return habitList(c);
    case "send": return sendTo(c, arg);
    case "focus": return focus(c);
    case "digest": return digest(c, arg);
    case "unlink":
      await c.db.from("chat_links").delete().eq("id", c.link.id);
      return "Unlinked. This chat can't reach your Momentum any more.";
    case "link": return "This chat is already linked. Send unlink first to link another account.";
    case "help": case "start": return c.permission === "add" ? `${ADD_ONLY_REPLY}\n\n${HELP.split("\n")[0]}` : HELP;
  }
}

/**
 * Runs one message from a chat and returns the private reply. Unlinked chats only get
 * instructions or link with a code; `plainAdds` makes a message without a command word an `add`.
 */
export async function runChat(db: SupabaseClient, chat: Chat, text: string, plainAdds = false): Promise<string> {
  const { data: link, error: lookup } = await db.from("chat_links").select("id, account_id, source, external_id, permission")
    .eq("source", chat.source).eq("external_id", chat.externalId).maybeSingle();
  // A failed lookup is a server problem, never "not linked": that sent people to re-link for nothing.
  if (lookup) {
    console.error("chat_links lookup failed", lookup);
    return SERVER_PROBLEM;
  }
  const key = link ? `chat:${link.id}` : `ext:${chat.source}:${chat.externalId}`;
  const { data: ok } = await db.rpc("hit_rate", { p_key: key, p_max: 60, p_window: "1 hour" });
  if (!ok) return "That's a lot of commands. Try again in a while.";
  const parsed = parseCommand(text) ?? (plainAdds && text.trim() ? { cmd: "add" as const, arg: text.trim() } : { cmd: "help" as const, arg: "" });
  if (!link) {
    if (parsed.cmd !== "link") return UNLINKED;
    const { error } = await db.rpc("link_chat", { p_code: parsed.arg, p_source: chat.source, p_external: chat.externalId, p_label: chat.label, p_reply: chat.reply });
    return error ? "That code didn't work. Codes last 10 minutes: get a new one in Settings → Connections." : `Linked. Try: add buy milk tomorrow\n\n${HELP}`;
  }
  // Keep where to reach the chat current (the Digest uses it).
  await db.from("chat_links").update({ reply: chat.reply, label: chat.label }).eq("id", link.id);
  return run(await context(db, link as Link, "chat"), parsed);
}

/**
 * The personal webhook, 500 calls a day per account. `{"text": "…"}` adds a task;
 * `{"command": "…"}` runs any command the webhook's permission allows (add-only by default).
 */
export async function runWebhook(db: SupabaseClient, secret: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: hook } = await db.from("webhooks").select("account_id, permission").eq("secret", secret).maybeSingle();
  if (!hook) return { status: 404, body: { error: "unknown webhook" } };
  const b = (typeof body === "object" && body !== null ? body : {}) as { text?: unknown; command?: unknown };
  const input = b.command !== undefined ? b.command : b.text;
  if (typeof input !== "string" || !input.trim() || input.length > 2000) return { status: 400, body: { error: 'send {"text": "…"} or {"command": "…"}' } };
  const parsed: Parsed = b.command !== undefined ? parseCommand(input) ?? { cmd: "help", arg: "" } : { cmd: "add", arg: input.trim() };
  const permission = (hook.permission as Permission | null) ?? "add";
  if (permission === "add" && !ADD_ONLY.has(parsed.cmd)) return { status: 403, body: { error: ADD_ONLY_REPLY } };
  const { data: ok } = await db.rpc("hit_rate", { p_key: `hook:${hook.account_id}`, p_max: 500, p_window: "1 day" });
  if (!ok) return { status: 429, body: { error: "500 a day" } };
  const c = await context(db, { id: "", account_id: hook.account_id as string, source: "telegram", external_id: "", permission }, "webhook");
  return { status: 200, body: { ok: true, reply: await run(c, parsed) } };
}
