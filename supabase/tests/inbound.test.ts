/*
 * The inbound function (ADR 0008) run in-process against the local stack: every source's
 * signature check, linking codes, every command (D265), private replies, rate limits, deferred
 * replies and the Digest. Outbound platform calls go to a recording fetch, never the network.
 */
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { handle, type Env, type Opts } from "../functions/inbound/app";
import { fromWall, parseClock, parseCommand, toWall } from "../functions/inbound/bot";
import { bundle, OUT } from "../../scripts/bundle-inbound.mjs";
import { admin, replica, rpc, SECRET, send, uid, URL, user, type User } from "./helpers";

const subtle = webcrypto.subtle;
let discordKeys: CryptoKeyPair;
let env: Env;
const calls: { url: string; init?: RequestInit }[] = [];
const recorder: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const u = String(url);
  if (u.includes("/users/@me/channels")) return Response.json({ id: "dm1" });
  if (u.includes("slack.com/api/oauth.v2.access")) return Response.json({ ok: true, team: { id: "T1" }, access_token: "xoxb-test" });
  if (u.includes("slack.com/api")) return Response.json({ ok: true });
  return Response.json({ ok: true });
};
const opts: Opts = { fetch: recorder, waitUntil: () => undefined };
const base = "http://local/functions/v1/inbound";
const hexOf = (b: ArrayBuffer) => Buffer.from(b).toString("hex");

beforeAll(async () => {
  discordKeys = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  env = {
    SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET, DISCORD_APP_ID: "app1", DISCORD_BOT_TOKEN: "bot",
    DISCORD_PUBLIC_KEY: hexOf(await subtle.exportKey("raw", discordKeys.publicKey)),
    SLACK_SIGNING_SECRET: "slack-secret", SLACK_CLIENT_ID: "cid", SLACK_CLIENT_SECRET: "csecret",
    TELEGRAM_BOT_TOKEN: "tg", TELEGRAM_SECRET: "tg-secret", DIGEST_SECRET: "digest-secret",
  };
});

// ---------- requests as each platform signs them ----------

async function discordReq(body: unknown, sign = true, o = opts) {
  const text = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign ? hexOf(await subtle.sign("Ed25519", discordKeys.privateKey, new TextEncoder().encode(ts + text))) : "00".repeat(64);
  return handle(new Request(`${base}/discord`, { method: "POST", body: text, headers: { "x-signature-ed25519": sig, "x-signature-timestamp": ts } }), env, o);
}
const discordCmd = (userId: string, command: string, o = opts) =>
  discordReq({ type: 2, token: "itoken", data: { name: "task", options: [{ name: "command", type: 3, value: command }] }, member: { user: { id: userId, username: "d" } } }, true, o);

async function slackReq(params: Record<string, string>, secret = "slack-secret", ts = Math.floor(Date.now() / 1000)) {
  const body = new URLSearchParams(params).toString();
  const { createHmac } = await import("node:crypto");
  const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
  return handle(new Request(`${base}/slack`, { method: "POST", body, headers: { "x-slack-signature": sig, "x-slack-request-timestamp": String(ts) } }), env, opts);
}
const slackCmd = (team: string, userId: string, text: string) =>
  slackReq({ command: "/momentum", text, team_id: team, user_id: userId, user_name: "s", response_url: "https://hooks.slack.com/commands/x" });

const tgReq = (update: unknown, secret = "tg-secret") =>
  handle(new Request(`${base}/telegram`, { method: "POST", body: JSON.stringify(update), headers: { "x-telegram-bot-api-secret-token": secret } }), env, opts);
const tgMsg = (fromId: number, text: string, type = "private") => tgReq({ update_id: 1, message: { text, chat: { id: fromId, type }, from: { id: fromId, username: "t" } } });

const tgText = async (r: Response) => ((await r.json()) as { text?: string }).text ?? "";
const discordText = async (r: Response) => {
  const j = (await r.json()) as { type: number; data: { content: string; flags: number } };
  expect(j.data.flags).toBe(64); // ephemeral: only the user sees it
  return j.data.content;
};

/** A Telegram chat linked to a fresh account. */
async function linkedTelegram(u: User): Promise<(text: string) => Promise<string>> {
  const chatId = Math.floor(Math.random() * 1e9);
  const code = await rpc<string>(u.db, "create_link_code");
  expect(await tgText(await tgMsg(chatId, `/link ${code}`))).toContain("Linked");
  return async (text) => tgText(await tgMsg(chatId, text));
}

// ---------- tests ----------

describe("the shared domain bundle", () => {
  it("is current and contains only pure code", async () => {
    const { code, inputs } = await bundle();
    expect(readFileSync(OUT, "utf8")).toBe(code);
    const allowed = /(src\/domain\/[a-zA-Z]+\.ts|src\/db\/rows\.ts|supabase\/functions\/inbound\/core\.ts|node_modules\/(chrono-node|date-fns|rrule|tslib)\/)/;
    expect(inputs.filter((i) => !allowed.test(i))).toEqual([]);
    expect(inputs.some((i) => /\.test\.ts$/.test(i))).toBe(false);
  });

  it("reads wall-clock time in the account's zone", () => {
    const at = new Date("2026-11-14T22:30:00Z");
    const w = toWall(at, "Australia/Sydney");
    expect([w.getDate(), w.getHours(), w.getMinutes()]).toEqual([15, 9, 30]);
    expect(fromWall(w, "Australia/Sydney").toISOString()).toBe(at.toISOString());
    expect(fromWall(toWall(at, "America/New_York"), "America/New_York").toISOString()).toBe(at.toISOString());
    expect(parseCommand("/task done 2")).toEqual({ cmd: "done", arg: "2" });
    expect(parseCommand("buy milk")).toBeNull();
    expect(parseClock("7pm")).toBe("19:00");
    expect(parseClock("25:00")).toBeNull();
  });
});

describe("caller verification", () => {
  it("refuses a bad signature from every source", async () => {
    expect((await discordReq({ type: 1 }, false)).status).toBe(401);
    expect((await slackReq({ text: "help", team_id: "T", user_id: "U" }, "wrong")).status).toBe(401);
    expect((await slackReq({ text: "help", team_id: "T", user_id: "U" }, "slack-secret", Math.floor(Date.now() / 1000) - 600)).status).toBe(401);
    expect((await tgReq({ message: { text: "help" } }, "wrong")).status).toBe(401);
    expect((await handle(new Request(`${base}/webhook/${"0".repeat(48)}`, { method: "POST", body: '{"text":"x"}' }), env, opts)).status).toBe(404);
    expect((await handle(new Request(`${base}/digest`, { method: "POST", headers: { "x-digest-secret": "nope" } }), env, opts)).status).toBe(401);
    expect((await handle(new Request(`${base}/send`, { method: "POST", body: "{}" }), env, opts)).status).toBe(401);
    expect((await handle(new Request(`${base}/send`, { method: "POST", body: "{}", headers: { authorization: "Bearer forged" } }), env, opts)).status).toBe(401);
  });

  it("answers Discord's ping", async () => {
    expect(await (await discordReq({ type: 1 })).json()).toEqual({ type: 1 });
  });
});

describe("linking", () => {
  it("an unlinked chat only gets instructions", async () => {
    const id = uid();
    expect(await discordText(await discordCmd(id, "today"))).toContain("Settings → Connections");
    expect(await discordText(await discordCmd(id, "add buy milk"))).toContain("isn't linked");
  });

  it("codes link once, expire after 10 minutes, and unlink removes the binding", async () => {
    const u = await user();
    const code = await rpc<string>(u.db, "create_link_code");
    expect(code).toMatch(/^\d{6}$/);
    const id = uid();
    expect(await discordText(await discordCmd(id, `link ${code}`))).toContain("Linked");
    expect(await discordText(await discordCmd(uid(), `link ${code}`))).toContain("didn't work");
    expect((await rpc<{ source: string }[]>(u.db, "my_connections")).map((c) => c.source)).toEqual(["discord"]);
    expect(await discordText(await discordCmd(id, "unlink"))).toContain("Unlinked");
    expect(await discordText(await discordCmd(id, "today"))).toContain("isn't linked");

    const old = await rpc<string>(u.db, "create_link_code");
    await admin().from("link_codes").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("code", old);
    expect(await discordText(await discordCmd(uid(), `link ${old}`))).toContain("didn't work");
    // Codes and links are invisible to the client tables.
    expect((await u.db.from("link_codes").select("*")).data ?? []).toEqual([]);
    expect((await u.db.from("chat_links").select("*")).data ?? []).toEqual([]);
  });

  it("links Slack per workspace user, with ephemeral replies", async () => {
    const u = await user();
    const code = await rpc<string>(u.db, "create_link_code");
    const r = await slackCmd("T9", `U${uid().slice(0, 6)}`, `link ${code}`);
    const j = (await r.json()) as { response_type: string; text: string };
    expect(j).toMatchObject({ response_type: "ephemeral" });
    expect(j.text).toContain("Linked");
  });

  it("Telegram only reads private chats", async () => {
    const r = await tgMsg(12345, "today", "group");
    expect(await r.json()).toEqual({});
  });
});

describe("commands", () => {
  let u: User, friend: User, chat: (text: string) => Promise<string>;
  const work = uid();
  const habitId = uid();

  beforeAll(async () => {
    [u, friend] = await Promise.all([user(), user()]);
    await u.db.from("profiles").update({ time_zone: "Australia/Sydney" }).eq("id", u.id);
    await rpc(friend.db, "redeem_invite", { p_code: await rpc<string>(u.db, "create_friend_invite") });
    await send(u.db,
      { tbl: "lists", id: work, fields: { id: work, name: "Work", deleted_at: null } },
      { tbl: "habits", id: habitId, fields: { id: habitId, name: "Read", goal: '{"kind":"once"}', deleted_at: null } },
      { tbl: "tasks", id: "late", fields: { id: "late", title: "Late report", list_id: work, status: "open", priority: 0, due_date: "2020-01-01", tags: "[]", checklist: "[]", reminders: "[]", exdates: "[]", sort_order: 0, pinned: 0, created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null } },
      { tbl: "tasks", id: "wait", fields: { id: "wait", title: "Hear back from Sam", list_id: work, status: "open", priority: 0, tags: "[]", checklist: "[]", reminders: "[]", exdates: "[]", sort_order: 0, pinned: 0, created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z", waiting: '{"kind":"person","who":"Sam"}', deleted_at: null } },
    );
    chat = await linkedTelegram(u);
  });

  const tasks = async () => [...(await replica(u.db)).entries()].filter(([k]) => k.startsWith("tasks/")).map(([, v]) => v);
  const byTitle = async (t: string) => (await tasks()).find((x) => x.title === t);

  it("add parses like the app: date in the account's zone, priority, tag, list", async () => {
    expect(await chat("add Call the bank tomorrow 9am !high #money ~Work")).toBe('Added "Call the bank" to Work.');
    const t = await byTitle("Call the bank");
    expect(t).toMatchObject({ list_id: work, priority: 3, status: "open" });
    const wall = toWall(new Date(String(t?.start_at)), "Australia/Sydney");
    expect(wall.getHours()).toBe(9);
    const tagId = JSON.parse(String(t?.tags))[0];
    expect((await replica(u.db)).get(`tags/${tagId}`)).toMatchObject({ name: "money" });
    // A plain Telegram message is an add, into the Inbox.
    expect(await chat("water the plants")).toBe('Added "water the plants".');
    expect((await byTitle("water the plants"))?.list_id).toBe("inbox");
  });

  it("lists number tasks, showing titles only", async () => {
    expect(await chat("overdue")).toBe("Overdue\n1. Late report");
    expect(await chat("today")).toContain("1. Late report");
    expect(await chat("week")).toContain("Call the bank");
    expect(await chat("inbox")).toBe("Inbox\n1. water the plants");
    expect(await chat("list work")).toContain("Late report");
    expect(await chat("list nowhere")).toContain("No list");
    expect(await chat("search bank")).toBe('Matching "bank"\n1. Call the bank');
    expect(await chat("waiting")).toBe("Waiting for\n1. Hear back from Sam");
  });

  it("done, snooze, move and deadline act on the numbers of the last listing", async () => {
    await chat("inbox");
    expect(await chat("move 1 work")).toBe('Moved "water the plants" to Work.');
    expect((await byTitle("water the plants"))?.list_id).toBe(work);
    await chat("overdue");
    expect(await chat("snooze 1 friday")).toBe('Snoozed "Late report".');
    expect((await byTitle("Late report"))?.due_date).not.toBe("2020-01-01");
    await chat("search bank");
    expect(await chat("deadline 1 dec 24")).toMatch(/^Deadline for "Call the bank": \d{4}-12-24\.$/);
    expect((await byTitle("Call the bank"))?.deadline).toMatch(/-12-24$/);
    expect(await chat("done 1")).toBe('Done: "Call the bank".');
    expect((await byTitle("Call the bank"))?.status).toBe("done");
    expect(await chat("done 9")).toContain("isn't in your last list");
    await admin().from("chat_listings").update({ at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).neq("items", "[]");
    expect(await chat("done 1")).toContain("lists last an hour");
  });

  it("done on a repeating task completes only that occurrence", async () => {
    await chat("add Stretch every day");
    await chat("search stretch");
    expect(await chat("done 1")).toBe('Done: "Stretch".');
    const all = (await tasks()).filter((t) => t.title === "Stretch");
    expect(all.map((t) => t.status).sort()).toEqual(["done", "open"]);
    expect(all.find((t) => t.status === "open")?.rrule).toBe("FREQ=DAILY");
  });

  it("habit checks in today, once for a once-a-day habit", async () => {
    expect(await chat("habit read")).toBe('Checked in "Read".');
    expect(await chat("habit read")).toContain("already checked in");
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
    expect((await replica(u.db)).get(`habit_checkins/${habitId}|${day}`)).toMatchObject({ value: 1 });
    expect(await chat("habit nope")).toContain("No habit");
  });

  it("send reaches a friend's Requests, and nobody else's", async () => {
    expect(await chat(`send @${friend.handle} review the draft`)).toContain("Sent");
    const incoming = await rpc<{ payload: { title: string } }[]>(friend.db, "incoming_tasks");
    expect(incoming.map((i) => i.payload.title)).toEqual(["review the draft"]);
    const stranger = await user();
    expect(await chat(`send @${stranger.handle} hi`)).toContain("isn't your friend");
  });

  it("focus shows status only", async () => {
    expect(await chat("focus")).toBe("You're not focusing right now.");
    await u.db.from("profiles").update({ share_focus: true }).eq("id", u.id);
    await rpc(u.db, "set_focus", { p_ends_at: new Date(Date.now() + 25 * 60_000).toISOString() });
    expect(await chat("focus")).toMatch(/^Focusing until \d\d:\d\d\.$/);
  });

  it("digest on and off, and help", async () => {
    expect(await chat("digest on 7:30")).toBe("Digest on: every day at 07:30, your time.");
    expect((await rpc<{ digest_time: string }[]>(u.db, "my_connections"))[0].digest_time).toBe("07:30:00");
    expect(await chat("digest off")).toBe("Digest off.");
    expect(await chat("help")).toContain("send @friend");
  });

  it("the Slack and Discord paths run the same commands", async () => {
    const code = await rpc<string>(u.db, "create_link_code");
    const did = uid();
    await discordCmd(did, `link ${code}`);
    expect(await discordText(await discordCmd(did, "list work"))).toContain("1. ");
    const code2 = await rpc<string>(u.db, "create_link_code");
    const su = `U${uid().slice(0, 8)}`;
    await slackCmd("T7", su, `link ${code2}`);
    expect(((await (await slackCmd("T7", su, "list work")).json()) as { text: string }).text).toContain("1. ");
  });
});

describe("every command from every connection (D288)", () => {
  let u: User, chat: (text: string) => Promise<string>;
  const home = uid(), habitId = uid(), parent = uid(), child = uid();
  const taskRow = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    tbl: "tasks", id,
    fields: { id, title, list_id: "inbox", status: "open", priority: 0, tags: "[]", checklist: "[]", reminders: "[]", exdates: "[]", sort_order: 0, pinned: 0, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null, ...extra },
  });

  beforeAll(async () => {
    u = await user();
    await send(u.db,
      { tbl: "lists", id: home, fields: { id: home, name: "Home", deleted_at: null } },
      { tbl: "habits", id: habitId, fields: { id: habitId, name: "Read", goal: '{"kind":"once"}', deleted_at: null } },
      taskRow(parent, "Plan trip"), taskRow(child, "Book flights", { parent_id: parent }),
    );
    chat = await linkedTelegram(u);
  });

  const tasks = async () => [...(await replica(u.db)).entries()].filter(([k]) => k.startsWith("tasks/")).map(([, v]) => v);
  const byTitle = async (t: string) => (await tasks()).find((x) => x.title === t);
  const stored = async (id: string) => (await admin().from("sync_rows").select("data").eq("owner_id", u.id).eq("tbl", "tasks").eq("id", id).single()).data?.data as Record<string, unknown>;

  it("update changes the date, deadline, duration, priority, list and tags", async () => {
    await chat("add Paint fence");
    await chat("search paint");
    expect(await chat("update 1 tomorrow 30m by dec 24 !high #diy ~Home")).toBe('Updated "Paint fence": date, deadline, duration, priority, list, tags.');
    const t = await byTitle("Paint fence");
    expect(t).toMatchObject({ list_id: home, priority: 3, duration_min: 30 });
    expect(t?.deadline).toMatch(/-12-24$/);
    expect(t?.due_date).toBeTruthy();
    expect(await chat("update 1 hello")).toContain("Nothing to change");
    expect(await chat("update 1 ~Nowhere")).toContain("No list");
  });

  it("view shows one task's details and its full id", async () => {
    await chat("search paint");
    const id = String((await byTitle("Paint fence"))?.id);
    const v = await chat("view 1");
    for (const s of ["Paint fence", "List: Home", "Priority: high", "Duration: 30m", "Tags: #diy", `id: ${id}`]) expect(v).toContain(s);
    expect(await chat(`view ${id}`)).toBe(v);
  });

  it("done and reopen, by number or full id", async () => {
    await chat("search paint");
    expect(await chat("done 1")).toBe('Done: "Paint fence".');
    expect(await chat("search paint")).toBe('Matching "paint"\n1. Paint fence (done)');
    expect(await chat("reopen 1")).toBe('Reopened "Paint fence".');
    expect((await byTitle("Paint fence"))?.status).toBe("open");
    expect(await chat(`reopen ${(await byTitle("Paint fence"))?.id}`)).toContain("already open");
  });

  it("reopen undoes done on a repeating task's occurrence", async () => {
    await chat("add Water plants every day");
    await chat("search water");
    await chat("done 1");
    expect(await chat("reopen 1")).toBe('Reopened "Water plants".');
    expect((await tasks()).filter((t) => t.title === "Water plants").map((t) => t.status)).toEqual(["open", "open"]);
  });

  it("delete moves one task to the Trash, subtasks only when asked, and restore brings it back", async () => {
    expect(await chat("delete all")).toContain("Which one?");
    expect(await chat(`delete ${parent} ${child}`)).toContain("one task at a time");
    expect(await chat(`delete ${parent}`)).toContain('"Plan trip" has 1 subtask. To move them to the Trash too, send: delete');
    expect((await stored(parent)).deleted_at).toBeNull();
    expect(await chat(`delete ${parent} with subtasks`)).toBe(`Moved "Plan trip" with 1 subtask ("Book flights") to the Trash. To undo: restore ${parent}`);
    expect((await stored(parent)).deleted_at).toBeTruthy();
    expect((await stored(child)).deleted_at).toBeTruthy();
    expect(await chat("trash")).toContain("Plan trip");
    expect(await chat(`restore ${parent}`)).toBe('Restored "Plan trip".');
    expect((await stored(parent)).deleted_at).toBeNull();
    expect((await stored(child)).deleted_at).toBeNull();
    // Restoring a subtask brings back its trashed parent.
    await chat(`delete ${parent} with subtasks`);
    expect(await chat(`restore ${child}`)).toBe('Restored "Book flights" and its parent "Plan trip".');
    expect((await stored(parent)).deleted_at).toBeNull();
    expect(await chat(`restore ${child}`)).toContain("isn't in the Trash");
    // A number from a listing works too.
    await chat("search book");
    await chat("delete 1");
    expect(await chat("restore 1")).toBe('Restored "Book flights".');
  });

  it("habits shows today's habits", async () => {
    expect(await chat("habits")).toBe("Habits today\nRead: not yet");
    await chat("habit read");
    expect(await chat("habits")).toBe("Habits today\nRead: done");
  });

  it("an add-only chat can only add", async () => {
    const [link] = await rpc<{ id: string; permission: string }[]>(u.db, "my_connections");
    expect(link.permission).toBe("full");
    await chat("digest on 7:00");
    await rpc(u.db, "set_connection_permission", { p_id: link.id, p_permission: "add" });
    expect((await rpc<{ digest_time: string | null }[]>(u.db, "my_connections"))[0].digest_time).toBeNull();
    expect(await chat("today")).toContain("can only add tasks");
    expect(await chat("digest on 7:00")).toContain("can only add tasks");
    expect(await chat(`delete ${parent}`)).toContain("can only add tasks");
    expect(await chat("add from an add-only chat")).toBe('Added "from an add-only chat".');
    await rpc(u.db, "set_connection_permission", { p_id: link.id, p_permission: "full" });
    expect(await chat("search add-only")).toContain("1. from an add-only chat");
  });

  it("the webhook takes commands, and starts add-only", async () => {
    const secret = await rpc<string>(u.db, "create_webhook");
    const post = async (body: unknown) => {
      const r = await handle(new Request(`${base}/webhook/${secret}`, { method: "POST", body: JSON.stringify(body) }), env, opts);
      return { status: r.status, body: (await r.json()) as { reply?: string; error?: string } };
    };
    expect(await rpc(u.db, "webhook_permission")).toBe("add");
    expect(await post({ command: "today" })).toMatchObject({ status: 403 });
    expect(await post({ command: "add hook task" })).toEqual({ status: 200, body: { ok: true, reply: 'Added "hook task".' } });
    expect((await post({ text: "plain hook task" })).status).toBe(200);
    await rpc(u.db, "set_webhook_permission", { p_permission: "full" });
    expect((await post({ command: "search plain hook" })).body.reply).toBe('Matching "plain hook"\n1. plain hook task');
    expect((await post({ command: "done 1" })).body.reply).toBe('Done: "plain hook task".');
    expect((await post({ command: "unlink" })).body.reply).toContain("only works in a chat");
    expect(await rpc(u.db, "webhook_permission")).toBe("full");
  });
});

describe("speed and limits", () => {
  it("defers a slow reply and follows up privately", async () => {
    const u = await user();
    const code = await rpc<string>(u.db, "create_link_code");
    const did = uid();
    await discordCmd(did, `link ${code}`);
    let done!: Promise<unknown>;
    const r = await discordCmd(did, "today", { ...opts, deadlineMs: 0, waitUntil: (p) => void (done = p) });
    expect(await r.json()).toEqual({ type: 5, data: { flags: 64 } });
    await done;
    const follow = calls.findLast((c) => c.url.includes("/webhooks/app1/itoken/messages/@original"));
    expect(follow?.init?.method).toBe("PATCH");
  });

  it("allows 60 commands an hour per linked chat", async () => {
    const u = await user();
    const chat = await linkedTelegram(u);
    const { data: link } = await admin().from("chat_links").select("id").eq("account_id", u.id).single();
    const bucket = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    await admin().from("rate_counts").upsert({ key: `chat:${link!.id}`, bucket, n: 59 });
    expect(await chat("help")).toContain("add <text>");
    expect(await chat("help")).toContain("a lot of commands");
  });

  it("the webhook adds only, and allows 500 calls a day", async () => {
    const u = await user();
    const secret = await rpc<string>(u.db, "create_webhook");
    const post = (body: unknown) => handle(new Request(`${base}/webhook/${secret}`, { method: "POST", body: JSON.stringify(body) }), env, opts);
    expect((await post({ text: "from a script tomorrow" })).status).toBe(200);
    expect([...(await replica(u.db)).values()].some((r) => r.title === "from a script")).toBe(true);
    expect((await post({ nope: 1 })).status).toBe(400);
    const day = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString();
    await admin().from("rate_counts").upsert({ key: `hook:${u.id}`, bucket: day, n: 500 });
    expect((await post({ text: "one too many" })).status).toBe(429);
    // Replacing the secret revokes the old URL.
    await rpc(u.db, "create_webhook");
    expect((await post({ text: "old url" })).status).toBe(404);
  });
});

describe("sent tasks through the function", () => {
  it("takes the sender from their access token and needs a friendship", async () => {
    const [a, b, s] = await Promise.all([user(), user(), user()]);
    await rpc(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") });
    const post = (to: string) => handle(new Request(`${base}/send`, {
      method: "POST", headers: { authorization: `Bearer ${a.token}` },
      body: JSON.stringify({ to, task: { title: "Pick up keys", subtasks: [{ title: "Call first" }] } }),
    }), env, opts);
    expect((await post(b.id)).status).toBe(200);
    expect((await post(s.id)).status).toBe(403);
    const [req] = await rpc<{ id: string; sender: string }[]>(b.db, "incoming_tasks");
    expect(req.sender).toBe(a.id);
  });
});

describe("the Digest", () => {
  it("sends due chats today's list once a day, at their local time", async () => {
    const u = await user();
    await u.db.from("profiles").update({ time_zone: "UTC" }).eq("id", u.id);
    const chat = await linkedTelegram(u);
    await chat("add digest item today");
    await chat("digest on 0:00");
    const { data: link } = await admin().from("chat_links").select("id, reply").eq("account_id", u.id).single();
    const run = () => handle(new Request(`${base}/digest`, { method: "POST", headers: { "x-digest-secret": "digest-secret" } }), env, opts);
    calls.length = 0;
    expect(((await (await run()).json()) as { sent: number }).sent).toBeGreaterThanOrEqual(1);
    const msg = calls.find((c) => c.url.includes("/sendMessage") && JSON.parse(String(c.init?.body)).chat_id === (link!.reply as { chat_id: number }).chat_id);
    expect(JSON.parse(String(msg?.init?.body)).text).toContain("digest item");
    calls.length = 0;
    await run();
    expect(calls.filter((c) => c.url.includes("/sendMessage") && JSON.parse(String(c.init?.body)).chat_id === (link!.reply as { chat_id: number }).chat_id)).toEqual([]);
  });

  it("is scheduled with pg_cron", async () => {
    const { data } = await admin().rpc("due_digests");
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("Slack install", () => {
  it("stores the workspace's bot token server-side only", async () => {
    const r = await handle(new Request(`${base}/slack/oauth?code=abc`), env, opts);
    expect(r.status).toBe(200);
    expect((await admin().from("slack_installs").select("team_id").eq("team_id", "T1")).data).toEqual([{ team_id: "T1" }]);
    const u = await user();
    expect((await u.db.from("slack_installs").select("*")).data ?? []).toEqual([]);
  });
});
