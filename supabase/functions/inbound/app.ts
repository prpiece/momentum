/*
 * The one inbound function (ADR 0008). Each adapter verifies its caller, turns the request into
 * text for bot.ts, and turns the reply into that platform's private reply. Every source answers
 * within 3 seconds; slower work is acknowledged and followed up.
 *
 *   POST /discord        Discord HTTP interactions (Ed25519), `/task …`
 *   POST /slack          Slack slash command `/momentum …` (signing secret)
 *   GET  /slack/oauth    Slack OAuth install redirect
 *   POST /telegram       Telegram bot webhook (secret token header), private chats only
 *   POST /webhook/<key>  the personal webhook: `{ "text": "…" }` adds, `{ "command": "…" }` runs a command (D288)
 *   POST /send           a sent task from a signed-in friend (their access token)
 *   POST /digest         pg_cron's Digest run (shared secret)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { digestText, runChat, runWebhook, type Chat, type Link } from "./bot.ts";

export type Env = Partial<Record<
  | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "DISCORD_PUBLIC_KEY" | "DISCORD_APP_ID" | "DISCORD_BOT_TOKEN"
  | "SLACK_SIGNING_SECRET" | "SLACK_CLIENT_ID" | "SLACK_CLIENT_SECRET" | "TELEGRAM_BOT_TOKEN" | "TELEGRAM_SECRET" | "DIGEST_SECRET",
  string>>;
export type Opts = { fetch?: typeof fetch; waitUntil?: (p: Promise<unknown>) => void; deadlineMs?: number; now?: () => number };

const enc = new TextEncoder();
const hex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const deny = (msg = "bad signature") => json({ error: msg }, 401);

/** Compares secrets without leaking where they differ. */
export function same(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export async function verifyDiscord(publicKey: string, sig: string | null, ts: string | null, body: string): Promise<boolean> {
  if (!publicKey || !sig || !ts || !/^[0-9a-f]{128}$/i.test(sig)) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), enc.encode(ts + body));
  } catch {
    return false;
  }
}

export async function verifySlack(secret: string, sig: string | null, ts: string | null, body: string, now: number): Promise<boolean> {
  if (!secret || !sig || !ts || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  return same(sig, `v0=${await hmac(secret, `v0:${ts}:${body}`)}`);
}

/**
 * How long a command may run before the "thinking…" placeholder goes out. Discord and Slack give up
 * after 3 s, counted from their request, and a cold start of this function already took ~2.3 s on the
 * live project before any code ran: the wait plus a cold start must stay under 3 s.
 */
export const REPLY_DEADLINE_MS = 500;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Runs `work` and answers with its result if it finishes in time; otherwise answers with
 * `early()` at once and hands the result to `later` (sent after the response).
 */
async function inTime(work: Promise<string>, opts: Opts, early: () => Response, now: (text: string) => Response, later: (text: string) => Promise<unknown>) {
  const timer = new Promise<null>((r) => setTimeout(() => r(null), opts.deadlineMs ?? REPLY_DEADLINE_MS));
  const safe = work.catch((e) => { console.error(e); return "Something went wrong. Try again in a moment."; });
  const first = await Promise.race([safe, timer]);
  if (first !== null) return now(first);
  const follow = safe.then(later).catch((e) => console.error("follow-up failed", e));
  opts.waitUntil?.(follow);
  return early();
}

// ---------- adapters ----------

async function discord(req: Request, env: Env, db: SupabaseClient, opts: Opts, f: typeof fetch): Promise<Response> {
  const body = await req.text();
  if (!(await verifyDiscord(env.DISCORD_PUBLIC_KEY ?? "", req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), body))) return deny();
  const i = JSON.parse(body);
  if (i.type === 1) return json({ type: 1 });
  if (i.type !== 2) return json({ type: 4, data: { content: "Not supported.", flags: 64 } });
  const user = i.member?.user ?? i.user;
  const text = String((i.data?.options ?? []).find((o: { name: string }) => o.name === "command")?.value ?? "help");
  const chat: Chat = { source: "discord", externalId: String(user.id), label: user.username ?? null, reply: { user_id: String(user.id) } };
  const reply = (content: string) => json({ type: 4, data: { content: clip(content, 1900), flags: 64 } });
  return inTime(runChat(db, chat, text), opts, () => json({ type: 5, data: { flags: 64 } }), reply, (content) =>
    f(`https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${i.token}/messages/@original`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: clip(content, 1900) }),
    }));
}

async function slack(req: Request, env: Env, db: SupabaseClient, opts: Opts, f: typeof fetch): Promise<Response> {
  const body = await req.text();
  const now = opts.now?.() ?? Date.now();
  if (!(await verifySlack(env.SLACK_SIGNING_SECRET ?? "", req.headers.get("x-slack-signature"), req.headers.get("x-slack-request-timestamp"), body, now))) return deny();
  const p = new URLSearchParams(body);
  const team = p.get("team_id") ?? "", user = p.get("user_id") ?? "";
  const chat: Chat = { source: "slack", externalId: `${team}:${user}`, label: p.get("user_name"), reply: { team_id: team, user_id: user } };
  const reply = (text: string) => json({ response_type: "ephemeral", text });
  const url = p.get("response_url") ?? "";
  return inTime(runChat(db, chat, p.get("text") ?? ""), opts, () => reply("Working on it…"), reply, (text) =>
    url.startsWith("https://hooks.slack.com/")
      ? f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response_type: "ephemeral", replace_original: true, text }) })
      : Promise.resolve());
}

async function slackOAuth(req: Request, env: Env, db: SupabaseClient, f: typeof fetch): Promise<Response> {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });
  const r = await f("https://slack.com/api/oauth.v2.access", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.SLACK_CLIENT_ID ?? "", client_secret: env.SLACK_CLIENT_SECRET ?? "" }),
  });
  const out = await r.json();
  if (!out.ok || !out.team?.id || !out.access_token) return new Response("Slack didn't accept the install. Try again.", { status: 400 });
  await db.from("slack_installs").upsert({ team_id: out.team.id, bot_token: out.access_token, installed_at: new Date().toISOString() });
  return new Response("Momentum is installed in your Slack workspace. Run /momentum help to start.", { headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function telegram(req: Request, env: Env, db: SupabaseClient, opts: Opts, f: typeof fetch): Promise<Response> {
  if (!same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", env.TELEGRAM_SECRET ?? "")) return deny();
  const u = await req.json();
  const m = u.message;
  // Private chats only: replies stay private, and group messages are never read (ADR 0008).
  if (!m?.text || m.chat?.type !== "private") return json({});
  const chat: Chat = { source: "telegram", externalId: String(m.from.id), label: m.from.username ?? null, reply: { chat_id: m.chat.id } };
  const send = (text: string) => ({ method: "sendMessage", chat_id: m.chat.id, text: clip(text, 4000) });
  return inTime(runChat(db, chat, m.text, true), opts, () => json({}), (text) => json(send(text)), (text) =>
    f(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(send(text)),
    }));
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" };

/** A sent task (D260): the signed-in sender, checked friendship, then the recipient's Requests. */
async function sendTask(req: Request, db: SupabaseClient): Promise<Response> {
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  const { data: who } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!who.user) return json({ error: "sign in" }, 401, CORS);
  const body = await req.json().catch(() => null);
  if (typeof body?.to !== "string" || typeof body?.task?.title !== "string") return json({ error: "send {to, task: {title, …}}" }, 400, CORS);
  const { data, error } = await db.rpc("send_task", { p_sender: who.user.id, p_recipient: body.to, p_payload: body.task });
  if (error) return json({ error: error.message }, error.message.includes("not_friends") ? 403 : 400, CORS);
  return json({ id: data }, 200, CORS);
}

/** Sends every due Digest to its chat and marks it sent for the account's day. */
async function digest(req: Request, env: Env, db: SupabaseClient, f: typeof fetch): Promise<Response> {
  if (!same(req.headers.get("x-digest-secret") ?? "", env.DIGEST_SECRET ?? "")) return deny();
  const { data: due, error } = await db.rpc("due_digests");
  if (error) throw error;
  let sent = 0;
  for (const d of due as { id: string; account_id: string; source: Link["source"]; reply: Record<string, string>; today: string }[]) {
    try {
      const text = await digestText(db, { id: d.id, account_id: d.account_id, source: d.source, external_id: "" });
      await deliver(env, db, f, d.source, d.reply, text);
      await db.from("chat_links").update({ digest_sent: d.today }).eq("id", d.id);
      sent++;
    } catch (e) {
      console.error("digest failed", d.id, e);
    }
  }
  return json({ sent });
}

/** A message to a linked chat outside a reply: a Discord DM, a Slack DM, or the Telegram chat. */
async function deliver(env: Env, db: SupabaseClient, f: typeof fetch, source: Link["source"], reply: Record<string, string>, text: string) {
  const ok = async (r: Response) => { if (!r.ok) throw new Error(`${source} ${r.status}`); return r; };
  if (source === "telegram") {
    await ok(await f(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: reply.chat_id, text: clip(text, 4000) }),
    }));
  } else if (source === "discord") {
    const auth = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" };
    const dm = await (await ok(await f("https://discord.com/api/v10/users/@me/channels", { method: "POST", headers: auth, body: JSON.stringify({ recipient_id: reply.user_id }) }))).json();
    await ok(await f(`https://discord.com/api/v10/channels/${dm.id}/messages`, { method: "POST", headers: auth, body: JSON.stringify({ content: clip(text, 1900) }) }));
  } else {
    const { data: install } = await db.from("slack_installs").select("bot_token").eq("team_id", reply.team_id).maybeSingle();
    if (!install) throw new Error("slack workspace not installed");
    const r = await (await ok(await f("https://slack.com/api/chat.postMessage", {
      method: "POST", headers: { authorization: `Bearer ${install.bot_token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: reply.user_id, text }),
    }))).json();
    if (!r.ok) throw new Error(`slack ${r.error}`);
  }
}

export async function handle(req: Request, env: Env, opts: Opts = {}): Promise<Response> {
  const f = opts.fetch ?? fetch;
  const path = new URL(req.url).pathname.replace(/^.*?\/inbound/, "");
  const db = createClient(env.SUPABASE_URL ?? "", env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method === "GET" && path === "/slack/oauth") return await slackOAuth(req, env, db, f);
    if (req.method !== "POST") return json({ error: "not found" }, 404);
    if (path === "/discord") return await discord(req, env, db, opts, f);
    if (path === "/slack") return await slack(req, env, db, opts, f);
    if (path === "/telegram") return await telegram(req, env, db, opts, f);
    if (path === "/send") return await sendTask(req, db);
    if (path === "/digest") return await digest(req, env, db, f);
    const hook = /^\/webhook\/([0-9a-f]{48})$/.exec(path);
    if (hook) {
      const body = await req.json().catch(() => null);
      const r = await runWebhook(db, hook[1], body);
      return json(r.body, r.status);
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
}
