/*
 * v1.2.1 server fixes (docs/specs/v1.2.1-fixes.md, G3): each test reproduces one finding.
 * Run with `npm run test:server`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
const MIGRATIONS = join(__dirname, "..", "migrations");
import { admin, ANON, folder, list, opts, pull, refusal, row, rpc, send, task, uid, URL, user, type User } from "./helpers";

async function invite(owner: User, share: string, member: User, role: "editor" | "viewer") {
  const code = await rpc<string>(owner.db, "create_share_invite", { p_share: share, p_role: role });
  await rpc(member.db, "redeem_invite", { p_code: code });
}
const stored = async (owner: string, tbl: string, id: string) =>
  (await admin().from("sync_rows").select("data").eq("owner_id", owner).eq("tbl", tbl).eq("id", id)).data?.[0]?.data as Record<string, unknown> | undefined;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const lastVersion = async (u: User) => (await pull(u.db)).at(-1)?.version ?? 0;

describe("C2: an editor can't write into the owner's private records", () => {
  it("refuses a create-shaped patch that reuses the id of a private task, list or activity", async () => {
    const [o, e] = await Promise.all([user(), user()]);
    const f = uid(), shared = uid(), priv = uid(), tShared = uid(), tPriv = uid(), act = uid();
    await send(o.db, folder(f), list(shared, f), list(priv), task(tShared, shared), task(tPriv, priv, { title: "private" }),
      { tbl: "task_activity", id: act, fields: { id: act, task_id: tPriv, at: daysAgo(0), kind: "created", detail: "private", deleted_at: null } });
    await invite(o, await rpc<string>(o.db, "create_share", { p_kind: "folder", p_container: f }), e, "editor");

    // The attack: create shapes (with `id`) aimed at the private records, routed through the shared folder and list.
    const r = await send(e.db,
      task(tPriv, shared, { title: "pwned" }),
      list(priv, f, { name: "pwned" }),
      { tbl: "task_activity", id: act, fields: { id: act, task_id: tShared, at: daysAgo(0), kind: "edited", detail: "pwned", deleted_at: null } },
    );
    expect(r.refused?.map((x) => x.reason)).toEqual(["no_access", "no_access", "no_access"]);
    expect(await stored(o.id, "tasks", tPriv)).toMatchObject({ title: "private", list_id: priv });
    expect(await stored(o.id, "lists", priv)).toMatchObject({ name: priv, folder_id: null });
    expect(await stored(o.id, "task_activity", act)).toMatchObject({ task_id: tPriv, detail: "private" });
    expect(await row(e.db, "tasks", tPriv)).toBeUndefined();
    // New records into the share still work.
    expect((await send(e.db, task(uid(), shared))).refused).toEqual([]);
  });
});

describe("membership and ownership", () => {
  it("set_member_role never activates a pending invitation", async () => {
    const [o, fr] = await Promise.all([user(), user()]);
    await rpc(fr.db, "redeem_invite", { p_code: await rpc<string>(o.db, "create_friend_invite") });
    const l = uid();
    await send(o.db, list(l), task(uid(), l));
    const s = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    await rpc(o.db, "invite_to_share", { p_share: s, p_friend: fr.id, p_role: "editor" });
    await rpc(o.db, "set_member_role", { p_share: s, p_account: fr.id, p_role: "viewer" });
    expect(await rpc(fr.db, "my_shares")).toContainEqual(expect.objectContaining({ share_id: s, role: "viewer", status: "invited" }));
    expect(await row(fr.db, "lists", l)).toBeUndefined();
  });

  it("transfer_share revokes the old owner's invite links", async () => {
    const [o, m, s] = await Promise.all([user(), user(), user()]);
    const l = uid();
    await send(o.db, list(l));
    const share = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    await invite(o, share, m, "editor");
    const code = await rpc<string>(o.db, "create_share_invite", { p_share: share, p_role: "editor" });
    await rpc(o.db, "transfer_share", { p_share: share, p_to: m.id });
    expect(await refusal(s.db, "redeem_invite", { p_code: code })).toContain("invite_invalid");
  });

  it("an owner's deletion passes on nested shares and gives everyone else tombstones", async () => {
    // Folder F (viewer V, no editor to inherit it) holds list A (its own share, editor L) and list B.
    const [o, v, l] = await Promise.all([user(), user(), user()]);
    const f = uid(), a = uid(), b = uid(), tA = uid();
    await send(o.db, folder(f), list(a, f), list(b, f), task(tA, a));
    const sF = await rpc<string>(o.db, "create_share", { p_kind: "folder", p_container: f });
    const sA = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: a });
    await invite(o, sF, v, "viewer");
    await invite(o, sA, l, "editor");
    const cursor = await lastVersion(v);
    await rpc(o.db, "request_account_deletion");
    await admin().from("account_deletions").update({ requested_at: daysAgo(8) }).eq("owner_id", o.id);
    expect((await admin().rpc("purge_deleted")).error).toBeNull();

    expect(await rpc(l.db, "my_shares")).toContainEqual(expect.objectContaining({ share_id: sA, role: "owner" }));
    expect(await row(l.db, "tasks", tA)).toBeTruthy();
    const gone = (await pull(v.db, cursor)).filter((r) => r.data.deleted_at).map((r) => `${r.tbl}/${r.id}`);
    expect(gone).toEqual(expect.arrayContaining([`folders/${f}`, `lists/${a}`, `lists/${b}`]));
  });
});

describe("purge_deleted", () => {
  it("keeps what tombstones need to reach share members", async () => {
    const [o, m] = await Promise.all([user(), user()]);
    const l = uid(), t = uid();
    await send(o.db, list(l), task(t, l));
    await invite(o, await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l }), m, "viewer");
    const cursor = await lastVersion(m);
    await send(o.db, { tbl: "tasks", id: t, fields: { deleted_at: daysAgo(40) } });
    expect((await admin().rpc("purge_deleted")).error).toBeNull();
    expect(await stored(o.id, "tasks", t)).toEqual({ deleted_at: expect.any(String), list_id: l });
    expect((await pull(m.db, cursor)).find((r) => r.id === t)?.data.deleted_at).toBeTruthy();
  });

  it("skips a malformed deleted_at instead of failing the whole run", async () => {
    const u = await user();
    const bad = uid();
    await send(u.db, { tbl: "tasks", id: bad, fields: { id: bad, title: "bad date", list_id: "inbox", deleted_at: "2020-13-45T99:00:00Z" } });
    expect((await admin().rpc("purge_deleted")).error).toBeNull();
    expect(await stored(u.id, "tasks", bad)).toMatchObject({ title: "bad date" });
    await admin().from("sync_rows").delete().eq("owner_id", u.id).eq("id", bad);
  });
});

describe("server-side writes take the shared-write path", () => {
  it("server_write splits a shared task's personal fields and stamps its creator", async () => {
    const [o, m] = await Promise.all([user(), user()]);
    const l = uid(), t = uid();
    await send(o.db, list(l));
    await invite(o, await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l }), m, "viewer");
    const w = await admin().rpc("server_write", { p_account: o.id, p_tbl: "tasks", p_id: t, p_fields: task(t, l, { tags: '["mine"]' }).fields });
    expect(w.error).toBeNull();
    expect((await row(o.db, "tasks", t))?.tags).toBe('["mine"]');
    expect((await row(m.db, "tasks", t))?.tags).toBe("[]");
    expect(await stored(o.id, "tasks", t)).toMatchObject({ created_by: o.id });
    expect((await stored(o.id, "tasks", t))?.tags).toBeUndefined();
  });

  it("server_write can't merge into another account's record either", async () => {
    const [o, e] = await Promise.all([user(), user()]);
    const f = uid(), shared = uid(), priv = uid(), tPriv = uid();
    await send(o.db, folder(f), list(shared, f), list(priv), task(tPriv, priv, { title: "private" }));
    await invite(o, await rpc<string>(o.db, "create_share", { p_kind: "folder", p_container: f }), e, "editor");
    const w = await admin().rpc("server_write", { p_account: e.id, p_tbl: "tasks", p_id: tPriv, p_fields: task(tPriv, shared, { title: "pwned" }).fields });
    expect(w.error?.message).toContain("no_access");
    expect(await stored(o.id, "tasks", tPriv)).toMatchObject({ title: "private" });
  });
});

describe("server version (D289)", () => {
  it("anyone can read schema_version", async () => {
    const { data, error } = await createClient(URL, ANON, opts).from("server_meta").select("schema_version").single();
    expect(error).toBeNull();
    expect(data?.schema_version).toBe(10);
  });
});

describe("the server functions' role", () => {
  // The live project gives the service role no table privileges by default (a local stack does), so
  // every direct read from `inbound` failed there. Every table any migration creates must be reachable.
  const tables = [...new Set(readdirSync(MIGRATIONS).flatMap((f) =>
    [...readFileSync(join(MIGRATIONS, f), "utf8").matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1])))];

  it.each(tables)("can read %s", async (t) => {
    const { error } = await admin().from(t).select("*").limit(1);
    expect(error).toBeNull();
  });
});
