/* v1.2.4 test findings SOC-02, SOC-09, SOC-14 (migration 20261116010000). Run with `npm run test:server`. */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, ANON, list, opts, refusal, row, rpc, send, task, uid, URL, user } from "./helpers";

describe("anon holds no privileges on comments and pings (20261118050000)", () => {
  it("can't execute the comment functions or read the ping tables", async () => {
    const anon = createClient(URL, ANON, opts);
    const calls: [string, Record<string, unknown>][] = [["task_comments", { p_task: "x" }], ["add_task_comment", { p_task: "x", p_body: "x" }],
      ["edit_task_comment", { p_id: uid(), p_body: "x" }], ["delete_task_comment", { p_id: uid() }]];
    for (const [fn, args] of calls) expect((await anon.rpc(fn, args)).error?.message, fn).toMatch(/permission denied/i);
    for (const t of ["social_pings", "sync_pings"]) expect((await anon.from(t).select("account_id")).error?.message, t).toMatch(/permission denied/i);
  });
});

async function friends() {
  const [a, b] = await Promise.all([user(), user()]);
  await rpc(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") });
  return { a, b };
}

describe("SOC-02: invitations and blocks", () => {
  it("blocking cancels a pending share invitation, so it can't be accepted", async () => {
    const { a, b } = await friends();
    const l = uid();
    await send(a.db, list(l));
    const share = await rpc<string>(a.db, "create_share", { p_kind: "list", p_container: l });
    await rpc(a.db, "invite_to_share", { p_share: share, p_friend: b.id, p_role: "editor" });
    await rpc(b.db, "block_account", { p_account: a.id });
    expect(await refusal(b.db, "respond_share", { p_share: share, p_accept: true })).toContain("no_such_invitation");
  });
});

describe("SOC-09: sent tasks are validated when sent", () => {
  it("refuses a long title and drops a priority outside 0..3", async () => {
    const { a, b } = await friends();
    const send_ = (payload: object) => admin().rpc("send_task", { p_sender: a.id, p_recipient: b.id, p_payload: payload });
    expect((await send_({ title: "x".repeat(501) })).error?.message).toContain("bad_title");
    const { data: id } = await send_({ title: "ok", priority: 99, subtasks: "nope" });
    const { data } = await admin().from("sent_tasks").select("payload").eq("id", id).single();
    expect(data?.payload).toEqual({ title: "ok" });
  });
});

describe("SOC-14: the handle limit", () => {
  it("clearing handle_changed_at doesn't allow a second change", async () => {
    const { db, id } = await user();
    await db.from("profiles").update({ handle_changed_at: null }).eq("id", id);
    const change = await db.from("profiles").update({ handle: `w${id.slice(0, 8)}` }).eq("id", id);
    expect(change.error?.message).toContain("handle_changed_recently");
  });
});

describe("SEC: per-account sync and backup quotas (migration 20261118030000)", () => {
  /** The usage counter the trigger keeps, read through the service role. */
  const usage = async (id: string) => (await admin().from("sync_usage").select("records, bytes").eq("owner_id", id).maybeSingle()).data;

  it("refuses growth past the cap, whichever way it arrives (create, editor's create, move in, big edit), but not a bare tombstone", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    // B is an editor of A's list, set up while A is under the cap.
    await rpc(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") });
    const l = uid();
    await send(a.db, list(l));
    const share = await rpc<string>(a.db, "create_share", { p_kind: "list", p_container: l });
    await rpc(a.db, "invite_to_share", { p_share: share, p_friend: b.id, p_role: "editor" });
    await rpc(b.db, "respond_share", { p_share: share, p_accept: true });
    expect((await send(b.db, task(uid(), l))).refused).toEqual([]);
    const mine = uid(), tag = uid();
    expect((await send(b.db, task(mine, "", { list_id: null }))).refused).toEqual([]);
    expect((await send(a.db, { tbl: "tags", id: tag, fields: { name: "t" } })).refused).toEqual([]);

    // Put A over the cap by setting its counter (a test-only shortcut on test data: the trigger path is the same).
    const over = await admin().from("sync_usage").update({ records: 250001 }).eq("owner_id", a.id);
    expect(over.error).toBeNull();

    const quota = (r: { refused?: { reason: string }[] }) => expect(r.refused?.[0]?.reason).toContain("quota_exceeded");
    // A's own new record.
    const fresh = uid();
    quota(await send(a.db, { tbl: "tags", id: fresh, fields: { name: "new" } }));
    expect(await row(a.db, "tags", fresh)).toBeUndefined();
    // B's create lands in A's namespace, so it is charged to A; nothing is left behind.
    const bt = uid();
    quota(await send(b.db, task(bt, l)));
    expect(await row(a.db, "tasks", bt)).toBeUndefined();
    // B moves a task of its own into A's list: charged to A too, and the task stays where it was.
    quota(await send(b.db, { tbl: "tasks", id: mine, fields: { list_id: l } }));
    expect((await row(b.db, "tasks", mine))?.list_id).not.toBe(l);
    // A big edit, and a tombstone that carries other fields, are refused; a bare tombstone goes through.
    quota(await send(a.db, { tbl: "tags", id: tag, fields: { name: "y".repeat(5000) } }));
    quota(await send(a.db, { tbl: "tags", id: tag, fields: { deleted_at: "2026-11-18T00:00:00.000Z", name: "still growing" } }));
    expect((await send(a.db, { tbl: "tags", id: tag, fields: { deleted_at: "2026-11-18T00:00:00.000Z" } })).refused).toEqual([]);
    // A tombstone can't create a record while over the cap.
    quota(await send(a.db, { tbl: "tags", id: uid(), fields: { deleted_at: "2026-11-18T00:00:00.000Z" } }));
    // Another account is unaffected.
    const other = await user();
    expect((await send(other.db, { tbl: "tags", id: uid(), fields: { name: "ok" } })).refused).toEqual([]);
  }, 60000);

  it("keeps sync_usage equal to the real rows through create, edit, move, delete", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    await rpc(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") });
    const l = uid();
    await send(a.db, list(l));
    const share = await rpc<string>(a.db, "create_share", { p_kind: "list", p_container: l });
    await rpc(a.db, "invite_to_share", { p_share: share, p_friend: b.id, p_role: "editor" });
    await rpc(b.db, "respond_share", { p_share: share, p_accept: true });
    const t = uid();
    await send(b.db, task(t, "", { list_id: null }));
    const count = async (id: string) => (await admin().from("sync_rows").select("id", { count: "exact", head: true }).eq("owner_id", id)).count;
    expect((await usage(b.id))?.records).toBe(await count(b.id));
    const before = (await usage(b.id))!.bytes;
    await send(b.db, { tbl: "tasks", id: t, fields: { title: "a much longer title than before" } });
    expect((await usage(b.id))!.bytes).toBeGreaterThan(before);
    // The move into A's list shifts the record (and its bytes) from B to A.
    await send(b.db, { tbl: "tasks", id: t, fields: { list_id: l } });
    for (const u of [a, b]) expect((await usage(u.id))?.records).toBe(await count(u.id));
    // Deleting every row, as the service role does, brings the counter back to zero.
    for (const u of [a, b]) {
      await admin().from("sync_rows").delete().eq("owner_id", u.id);
      expect(await usage(u.id)).toMatchObject({ records: 0, bytes: 0 });
    }
  }, 60000);

  it("refuses a cloud backup upload past the object cap", async () => {
    const { db, id } = await user();
    const up = (n: string) => db.storage.from("backups").upload(`${id}/${n}.json`, new Blob(["{}"]), { contentType: "application/json" });
    for (let i = 0; i < 70; i++) expect((await up(`momentum-auto-${i}`)).error).toBeNull();
    expect((await up("momentum-auto-70")).error).not.toBeNull();
  }, 120000);
});

describe("per-caller rate limits come before the global ones", () => {
  const bucket = async (key: string) => (await admin().from("rate_counts").select("n").eq("key", key)).data?.reduce((t, r) => t + r.n, 0) ?? 0;

  /** Waits out an hour (or day) boundary so a bucket can't roll over in the middle of a test. */
  const clear = async (period: number) => {
    const left = period - ((Date.now() / 1000) % period);
    if (left < 30) await new Promise((r) => setTimeout(r, (left + 1) * 1000));
  };
  const reportBody = JSON.stringify({ name: "x", email: "a@example.test", body: "Spam spam spam spam", app_version: "1", platform: "test" });
  /** A raw report insert, so headers can be set. Returns "" when accepted, else the error text. */
  const report = async (headers: Record<string, string>) => {
    const r = await fetch(`${URL}/rest/v1/reports`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json", prefer: "return=minimal", ...headers }, body: reportBody });
    return r.ok ? "" : await r.text();
  };

  it("wrong link guesses are counted durably; a chat past its budget is refused even with the right code", async () => {
    await clear(3600);
    const ext = uid();
    const link = (code: string) => admin().rpc("link_chat", { p_code: code, p_source: "telegram", p_external: ext, p_label: null, p_reply: {} });
    const allBefore = await bucket("link:all");
    for (let i = 0; i < 60; i++) expect((await link("00000000")).data).toBeNull();
    expect(await bucket(`link:telegram:${ext}`)).toBe(60); // a raise would have rolled these back
    expect(await bucket("link:all")).toBeGreaterThanOrEqual(allBefore + 60);
    const code = await rpc<string>((await user()).db, "create_link_code");
    const allBeforeLast = await bucket("link:all");
    expect((await link(code)).data).toBeNull(); // the 61st: refused by its own key, code untouched
    expect(await bucket("link:all")).toBe(allBeforeLast); // so it never reached the global key
    expect((await admin().from("link_codes").select("code").eq("code", code)).data).toHaveLength(1);
  }, 120_000);

  it("anonymous reports: 5 an hour per address, and only accepted ones count", async () => {
    await clear(3600);
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    const allBefore = await bucket("report:all");
    for (let i = 0; i < 5; i++) expect(await report({ "cf-connecting-ip": ip })).toBe("");
    expect(await report({ "cf-connecting-ip": ip })).toContain("too_many_reports");
    expect(await bucket(`report:ip:${ip}`)).toBe(5); // the refused one rolled back its own count
    expect(await bucket("report:all")).toBeGreaterThanOrEqual(allBefore + 5);
  }, 60_000);

  it("client_key prefers the account over the address", async () => {
    await clear(3600);
    const a = await user();
    const ip = `192.0.2.${Math.floor(Math.random() * 250)}`;
    expect(await report({ "cf-connecting-ip": ip, authorization: `Bearer ${a.token}` })).toBe("");
    expect(await bucket(`report:${a.id}`)).toBe(1);
    expect(await bucket(`report:ip:${ip}`)).toBe(0);
  });

  it("an anonymous report with no address header still goes through (no per-address key)", async () => {
    expect(await report({})).toBe("");
  });
});

describe("AUTH: password sign-up cannot pre-register an email", () => {
  it("gives no session for an unverified address, and the password cannot sign in", async () => {
    const email = `victim-${randomUUID()}@example.test`;
    const password = randomUUID();
    const anon = createClient(URL, ANON, opts);
    const up = await anon.auth.signUp({ email, password });
    expect(up.data.session).toBeNull();
    const signIn = await anon.auth.signInWithPassword({ email, password });
    expect(signIn.data.session).toBeNull();
    expect(signIn.error).not.toBeNull();
  });

  it("the victim confirming by code doesn't leave the attacker's password working", async () => {
    const email = `victim-${randomUUID()}@example.test`;
    const password = randomUUID();
    const anon = createClient(URL, ANON, opts);
    await anon.auth.signUp({ email, password });
    const { data: link, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    const verified = await anon.auth.verifyOtp({ email, token: link.properties.email_otp, type: "email" });
    expect(verified.data.session).not.toBeNull();
    await anon.auth.signOut();
    const signIn = await anon.auth.signInWithPassword({ email, password });
    expect(signIn.data.session).toBeNull();
    expect(signIn.error).not.toBeNull();
  });
});

describe("AUTH: the unconfirmed-password trigger", () => {
  const signIn = (email: string, password: string) => createClient(URL, ANON, opts).auth.signInWithPassword({ email, password });

  it("confirming an unconfirmed admin-created user clears its password", async () => {
    const email = `t-${randomUUID()}@example.test`;
    const password = randomUUID();
    const { data, error } = await admin().auth.admin.createUser({ email, password });
    if (error) throw error;
    const upd = await admin().auth.admin.updateUserById(data.user.id, { email_confirm: true });
    if (upd.error) throw upd.error;
    expect((await signIn(email, password)).error).not.toBeNull();
  });

  it("a user created already confirmed keeps its password", async () => {
    const email = `t-${randomUUID()}@example.test`;
    const password = randomUUID();
    const { error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    expect((await signIn(email, password)).error).toBeNull();
  });
});
