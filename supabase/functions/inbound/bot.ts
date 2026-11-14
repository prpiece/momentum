/*
 * The chat commands (PLAN D265), shared by every adapter. Text in, private reply text out; every
 * write lands in the account's own records through `server_write`, so its devices pull it like
 * any synced change. Runs in Deno (the Edge Function) and in Node (the server tests).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as core from "./core.bundle.js";
import type { LocalDate, Schedule, Task } from "./core.bundle.js";

export type Source = "discord" | "slack" | "telegram";
export type Link = { id: string; account_id: string; source: Source; external_id: string };
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

async function records(db: SupabaseClient, account: string, tbl: string): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("sync_rows").select("id, data").eq("owner_id", account).eq("tbl", tbl)
      .is("data->>deleted_at", null).order("id").range(from, from + 999);
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
  "add <text> — add a task (same tokens as the app: tomorrow 5pm, !high, #tag, ~List)",
  "today · week · overdue · inbox — list tasks, numbered",
  "list <name> · search <text> · waiting",
  "done N · snooze N <when> · move N <list> · deadline N <date>",
  "habit <name> — check in a habit",
  "send @friend <text> — send a task to a friend",
  "focus — your focus status",
  "digest on <time> · digest off — a daily list at that time",
  "unlink — disconnect this chat",
].join("\n");

export const UNLINKED =
  "This chat isn't linked to Momentum yet. In the app open Settings → Connections, choose Link a chat, then send: link <code>";

const COMMANDS = ["add", "today", "week", "overdue", "inbox", "list", "search", "waiting", "done", "snooze", "move", "deadline",
  "habit", "send", "focus", "digest", "help", "unlink", "link", "start"] as const;
type Command = (typeof COMMANDS)[number];

/** Splits "done 2" into a command and its argument; anything else is `null` (Telegram: a plain message adds it). */
export function parseCommand(text: string): { cmd: Command; arg: string } | null {
  const t = text.trim().replace(/^\/(task|momentum)(@\w+)?\s*/i, "").replace(/^\//, "");
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t);
  if (!m) return null;
  const word = m[1].toLowerCase().replace(/@\w+$/, "");
  return (COMMANDS as readonly string[]).includes(word) ? { cmd: word as Command, arg: m[2].trim() } : null;
}

type Ctx = { db: SupabaseClient; link: Link; tz: string };
type Item = { id: string; key: string | null };

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

/** Numbers the tasks for `done N` and friends, remembering them for an hour. */
async function listing(c: Ctx, heading: string, vms: { task: Task; key: string | null; date: string | null }[], empty: string) {
  const shown = [...vms].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || b.task.priority - a.task.priority).slice(0, 50);
  const items: Item[] = shown.map((v) => ({ id: v.task.id, key: v.key }));
  await c.db.from("chat_listings").upsert({ link_id: c.link.id, items, at: iso() });
  if (!shown.length) return empty;
  return [heading, ...shown.map((v, i) => `${i + 1}. ${v.task.title}`)].join("\n");
}

async function pick(c: Ctx, arg: string): Promise<{ item: Item; rest: string } | string> {
  const m = /^(\d+)\s*([\s\S]*)$/.exec(arg);
  if (!m) return "Which one? Use the number from your last list, e.g. done 2.";
  const { data } = await c.db.from("chat_listings").select("items, at").eq("link_id", c.link.id).maybeSingle();
  const fresh = data && Date.parse(data.at as string) > Date.now() - 3_600_000;
  const item = fresh ? (data.items as Item[])[Number(m[1]) - 1] : undefined;
  if (!item) return "That number isn't in your last list (lists last an hour). Ask for today, week or inbox again.";
  return { item, rest: m[2].trim() };
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

function descendants(all: Task[], id: string): Task[] {
  const kids = all.filter((t) => t.parentId === id);
  return kids.flatMap((k) => [k, ...descendants(all, k.id)]);
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

async function add(c: Ctx, text: string): Promise<string> {
  if (!text) return "What should I add? e.g. add buy milk tomorrow";
  const lists = await listsOf(c);
  const p = core.parseQuickAdd(text, toWall(new Date(), c.tz), true, lists.map((l) => l.name));
  const listName = p.listName ? core.bestName(p.listName, lists.map((l) => l.name)) : null;
  const list = lists.find((l) => l.name === listName);
  const schedule = mapTimed(p.schedule, (i) => fromWall(new Date(i), c.tz).toISOString());
  const at = iso();
  const task: Task = {
    id: crypto.randomUUID(), title: p.title.slice(0, 500), description: "", listId: list?.id ?? core.INBOX_ID, parentId: null, sectionId: null,
    status: "open", priority: p.priority ?? 0, schedule, recurrence: p.rule ? { rule: p.rule, exdates: [] } : null, recurrenceParentId: null,
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
  const lists = await listsOf(c);
  const hit = core.bestName(name, lists.map((l) => l.name));
  const list = lists.find((l) => l.name === hit);
  if (!list) return `No list called "${name}".`;
  const { vms } = await tasksOf(c);
  return listing(c, list.name, vms.filter((v) => v.task.status === "open" && v.task.listId === list.id), `${list.name} has no open tasks.`);
}

async function search(c: Ctx, q: string): Promise<string> {
  if (!q) return "Search for what? e.g. search invoice";
  const { vms } = await tasksOf(c);
  const hits = vms
    .filter((v) => v.task.status === "open")
    .map((v) => ({ v, s: core.matchScore(v.task.title, q) }))
    .filter((x): x is { v: (typeof vms)[number]; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s)
    .slice(0, 20)
    .map((x) => x.v);
  return listing(c, `Matching "${q}"`, hits, `Nothing matches "${q}".`);
}

async function change(c: Ctx, cmd: "done" | "snooze" | "move" | "deadline", arg: string): Promise<string> {
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
    return `Done: "${task.title}".`;
  }
  if (cmd === "move") {
    const lists = await listsOf(c);
    const hit = core.bestName(p.rest, lists.map((l) => l.name));
    const list = lists.find((l) => l.name === hit);
    if (!p.rest || !list) return p.rest ? `No list called "${p.rest}".` : "Move it where? e.g. move 2 Work";
    const kids = descendants(all, task.id).map((k) => ({ ...k, listId: list.id, sectionId: null, updatedAt: at }));
    await save(c, ...extra, { ...task, listId: list.id, sectionId: null, updatedAt: at }, ...kids);
    await log(c, task.id, "moved", list.name);
    return `Moved "${task.title}" to ${list.name}.`;
  }
  const when = core.parseQuickAdd(p.rest, toWall(new Date(), c.tz));
  if (when.schedule.kind === "none") return cmd === "snooze" ? "Snooze to when? e.g. snooze 2 tomorrow 9am" : "Which date? e.g. deadline 2 friday";
  if (cmd === "deadline") {
    const date = when.schedule.kind === "day" ? when.schedule.date : core.toLocalDate(new Date(when.schedule.start));
    // Deadline (D267): a local date under `deadline` (v1.3 handoff).
    await save(c, ...extra);
    await write(c.db, c.link.account_id, "tasks", task.id, { ...core.taskToRow({ ...task, updatedAt: at }), deadline: date });
    return `Deadline for "${task.title}": ${date}.`;
  }
  const shifted = shiftTask(task, c.tz);
  const next: Schedule = when.schedule.kind === "timed"
    ? when.schedule
    : core.moveToDate(shifted.schedule.kind === "none" ? { kind: "day", date: when.schedule.date } : shifted.schedule, when.schedule.date);
  const moved = unshiftTask({ ...shifted, schedule: next, updatedAt: at }, c.tz);
  await save(c, ...extra, moved);
  return `Snoozed "${task.title}".`;
}

async function habit(c: Ctx, name: string): Promise<string> {
  if (!name) return "Which habit? e.g. habit read";
  const habits = await records(c.db, c.link.account_id, "habits");
  const hit = core.bestName(name, habits.map((h) => String(h.name ?? "")));
  const h = habits.find((x) => x.name === hit);
  if (!h) return `No habit called "${name}".`;
  const d = today(c.tz);
  const id = `${h.id}|${d}`;
  const { data } = await c.db.from("sync_rows").select("data").eq("owner_id", c.link.account_id).eq("tbl", "habit_checkins").eq("id", id).maybeSingle();
  const cur = data?.data as { value?: number; deleted_at?: string | null } | undefined;
  const value = cur && !cur.deleted_at ? Number(cur.value ?? 0) : 0;
  let goal: { kind?: string } = {};
  try {
    goal = JSON.parse(String(h.goal ?? "{}"));
  } catch { /* the app's default */ }
  if ((goal.kind ?? "once") === "once" && value >= 1) return `"${h.name}" is already checked in today.`;
  await write(c.db, c.link.account_id, "habit_checkins", id, { habit_id: h.id, date: d, _delta: 1, deleted_at: null });
  return `Checked in "${h.name}".`;
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
  const w = toWall(ends, c.tz);
  return `Focusing until ${String(w.getHours()).padStart(2, "0")}:${String(w.getMinutes()).padStart(2, "0")}.`;
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
  const c = await context(db, link);
  return `Good morning. ${await show(c, "today")}`;
}

async function context(db: SupabaseClient, link: Link): Promise<Ctx> {
  const { data } = await db.from("profiles").select("time_zone").eq("id", link.account_id).maybeSingle();
  return { db, link, tz: validZone(data?.time_zone) };
}

/**
 * Runs one message from a chat and returns the private reply. Unlinked chats only get
 * instructions or link with a code; `plainAdds` makes a message without a command word an `add`.
 */
export async function runChat(db: SupabaseClient, chat: Chat, text: string, plainAdds = false): Promise<string> {
  const { data: link } = await db.from("chat_links").select("id, account_id, source, external_id")
    .eq("source", chat.source).eq("external_id", chat.externalId).maybeSingle();
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
  const c = await context(db, link as Link);
  switch (parsed.cmd) {
    case "add": return add(c, parsed.arg);
    case "today": case "week": case "overdue": case "inbox": case "waiting": return show(c, parsed.cmd);
    case "list": return inList(c, parsed.arg);
    case "search": return search(c, parsed.arg);
    case "done": case "snooze": case "move": case "deadline": return change(c, parsed.cmd, parsed.arg);
    case "habit": return habit(c, parsed.arg);
    case "send": return sendTo(c, parsed.arg);
    case "focus": return focus(c);
    case "digest": return digest(c, parsed.arg);
    case "unlink":
      await db.from("chat_links").delete().eq("id", link.id);
      return "Unlinked. This chat can't reach your Momentum any more.";
    case "link": return "This chat is already linked. Send unlink first to link another account.";
    case "help": case "start": return HELP;
  }
}

/** The personal webhook: add only, 500 a day per account. */
export async function runWebhook(db: SupabaseClient, secret: string, text: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: hook } = await db.from("webhooks").select("account_id").eq("secret", secret).maybeSingle();
  if (!hook) return { status: 404, body: { error: "unknown webhook" } };
  if (typeof text !== "string" || !text.trim() || text.length > 2000) return { status: 400, body: { error: 'send {"text": "…"}' } };
  const { data: ok } = await db.rpc("hit_rate", { p_key: `hook:${hook.account_id}`, p_max: 500, p_window: "1 day" });
  if (!ok) return { status: 429, body: { error: "500 a day" } };
  const c = await context(db, { id: "", account_id: hook.account_id as string, source: "telegram", external_id: "" });
  await add(c, text.trim());
  return { status: 200, body: { ok: true } };
}
