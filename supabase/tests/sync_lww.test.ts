/*
 * v1.2.4 findings SYNC-11 (per-field last writer wins), SYNC-15 (wake-ups through sync_pings, not
 * `devices`) and SOC-13 (profiles readable by their owner only). Run with `npm run test:server`.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { admin, list, push, row, rpc, send, task, uid, user } from "./helpers";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe("SYNC-11: per-field last writer wins", () => {
  it("an offline edit made before another device's edit doesn't overwrite it, and other fields still land", async () => {
    const u = await user();
    const [a, b] = [randomUUID(), randomUUID()];
    const l = uid(), t = uid();
    await push(u.db, a, [{ seq: 1, ...list(l), ts: ago(120) }, { seq: 2, ...task(t, l), ts: ago(120) }]);
    await push(u.db, b, [{ seq: 1, tbl: "tasks", id: t, fields: { title: "Y" }, ts: ago(10) }]);
    // A was offline: its rename is older than B's, its pin is new.
    const r = await push(u.db, a, [{ seq: 3, tbl: "tasks", id: t, fields: { title: "X", pinned: 1 }, ts: { title: ago(60), pinned: ago(60) } }]);
    expect(r.refused).toEqual([]);
    expect(await row(u.db, "tasks", t)).toMatchObject({ title: "Y", pinned: 1 });
    // A newer edit still wins.
    await push(u.db, a, [{ seq: 4, tbl: "tasks", id: t, fields: { title: "Z" }, ts: ago(1) }]);
    expect((await row(u.db, "tasks", t))?.title).toBe("Z");
  });

  it("clamps a clock far in the future to five minutes ahead", async () => {
    const u = await user();
    const [a, b] = [randomUUID(), randomUUID()];
    const l = uid(), t = uid();
    await push(u.db, a, [{ seq: 1, ...list(l) }, { seq: 2, ...task(t, l), ts: "2099-01-01T00:00:00.000Z" }]);
    const { data } = await admin().from("sync_rows").select("field_ts").eq("owner_id", u.id).eq("tbl", "tasks").eq("id", t).single();
    const stamp = String((data?.field_ts as Record<string, string>).title);
    expect(Date.parse(stamp.split("|")[0])).toBeLessThan(Date.now() + 6 * 60_000);
    expect(stamp.endsWith(`|${a}`)).toBe(true);
    await push(u.db, b, [{ seq: 1, tbl: "tasks", id: t, fields: { title: "later" }, ts: new Date(Date.now() + 10 * 60_000).toISOString() }]);
    expect((await row(u.db, "tasks", t))?.title).toBe("later");
  });

  it("an older app's patch (no ts) always applies, and a delete that lost to a newer restore doesn't purge", async () => {
    const u = await user();
    const [a, b] = [randomUUID(), randomUUID()];
    const l = uid(), t = uid();
    await push(u.db, a, [{ seq: 1, ...list(l), ts: ago(5) }, { seq: 2, ...task(t, l), ts: ago(5) }]);
    await push(u.db, b, [{ seq: 1, tbl: "tasks", id: t, fields: { title: "old app" } }]);
    expect((await row(u.db, "tasks", t))?.title).toBe("old app");
    await push(u.db, b, [{ seq: 2, tbl: "tasks", id: t, fields: { deleted_at: null }, ts: ago(1) }]);
    await push(u.db, a, [{ seq: 3, tbl: "tasks", id: t, fields: { deleted_at: ago(3), _purged: 1 }, ts: ago(3) }]);
    const r = await row(u.db, "tasks", t);
    expect(r).toBeDefined();
    expect(r).not.toHaveProperty("_purged");
  });

  it("increments and set deltas merge whatever their time", async () => {
    const u = await user();
    const [a, b] = [randomUUID(), randomUUID()];
    const l = uid(), t = uid();
    await push(u.db, a, [{ seq: 1, ...list(l) }, { seq: 2, ...task(t, l, { tags: '["a"]' }), ts: ago(5) }]);
    await push(u.db, b, [{ seq: 1, tbl: "tasks", id: t, fields: { tags: '["a","b"]', _add_tags: ["b"], _del_tags: [] }, ts: ago(1) }]);
    await push(u.db, a, [{ seq: 3, tbl: "tasks", id: t, fields: { tags: '["a","c"]', _add_tags: ["c"], _del_tags: [] }, ts: ago(3) }]);
    expect(JSON.parse(String((await row(u.db, "tasks", t))?.tags))).toEqual(["a", "c", "b"]);
  });

  it("stamps a shared task's personal fields per member, so one member's tags don't block another's", async () => {
    const [o, m] = await Promise.all([user(), user()]);
    const l = uid(), t = uid();
    await send(o.db, list(l), task(t, l));
    await rpc(m.db, "redeem_invite", { p_code: await rpc<string>(o.db, "create_share_invite", { p_share: await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l }), p_role: "editor" }) });
    await push(o.db, randomUUID(), [{ seq: 1, tbl: "tasks", id: t, fields: { pinned: 1 }, ts: ago(1) }]);
    await push(m.db, randomUUID(), [{ seq: 1, tbl: "tasks", id: t, fields: { pinned: 1 }, ts: ago(30) }]);
    expect(await row(m.db, "tasks", t)).toMatchObject({ pinned: 1 });
    await push(o.db, randomUUID(), [{ seq: 1, tbl: "tasks", id: t, fields: { title: "new" }, ts: ago(0) }]);
    await push(m.db, randomUUID(), [{ seq: 1, tbl: "tasks", id: t, fields: { title: "stale" }, ts: ago(20) }]);
    expect((await row(o.db, "tasks", t))?.title).toBe("new");
  });
});

describe("SYNC-11: a viewer's dropped activity leaves no stamp", () => {
  it("a viewer's patch with a future ts plants nothing, so the editor's edit with a current ts wins", async () => {
    const [o, v] = await Promise.all([user(), user()]);
    await rpc(v.db, "redeem_invite", { p_code: await rpc<string>(o.db, "create_friend_invite") });
    const l = uid(), t = uid(), act = uid();
    const fields = { id: act, task_id: t, at: ago(0), kind: "edited", detail: "orig", deleted_at: null };
    await push(o.db, randomUUID(), [{ seq: 1, ...list(l) }, { seq: 2, ...task(t, l) }, { seq: 3, tbl: "task_activity", id: act, fields, ts: ago(30) }]);
    const share = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    await rpc(o.db, "invite_to_share", { p_share: share, p_friend: v.id, p_role: "viewer" });
    await rpc(v.db, "respond_share", { p_share: share, p_accept: true });
    const stamps = async () => (await admin().from("sync_rows").select("field_ts").eq("owner_id", o.id).eq("tbl", "task_activity").eq("id", act).single()).data?.field_ts;
    const before = await stamps();

    // The viewer's patch is dropped, with a stamp five minutes ahead.
    await push(v.db, randomUUID(), [{ seq: 1, tbl: "task_activity", id: act, fields: { detail: "pwned" }, ts: new Date(Date.now() + 5 * 60_000).toISOString() }]);
    expect(await stamps()).toEqual(before);
    expect(await row(o.db, "task_activity", act)).toMatchObject({ detail: "orig" });

    // The editor's genuine edit, stamped now, is not shadowed.
    await push(o.db, randomUUID(), [{ seq: 1, tbl: "task_activity", id: act, fields: { detail: "edited" }, ts: ago(0) }]);
    expect(await row(o.db, "task_activity", act)).toMatchObject({ detail: "edited" });
  });
});

describe("SYNC-15: wake-ups", () => {
  it("a push pings the account with the pushing device; a server-side ping names none", async () => {
    const u = await user();
    const d = randomUUID();
    await push(u.db, d, [{ seq: 1, ...list(uid()) }]);
    expect((await u.db.from("sync_pings").select("account_id, device")).data).toEqual([{ account_id: u.id, device: d }]);
    await admin().rpc("ping_all", { p_account: u.id });
    expect((await u.db.from("sync_pings").select("device")).data).toEqual([{ device: null }]);
  });
});

describe("SOC-13: profiles", () => {
  it("a stranger with a pending friend request can't read the profile row", async () => {
    const [a, s] = await Promise.all([user(), user()]);
    await a.db.from("profiles").update({ time_zone: "Australia/Sydney" }).eq("id", a.id);
    expect(await rpc(s.db, "request_friend", { p_handle: a.handle })).not.toBe("no_such_account");
    expect((await s.db.from("profiles").select("time_zone").eq("id", a.id)).data).toEqual([]);
    expect((await a.db.from("profiles").select("time_zone").eq("id", a.id)).data).toEqual([{ time_zone: "Australia/Sydney" }]);
  });
});

describe("server_write stamps its fields (20261118110000)", () => {
  it("an earlier offline edit loses to a chat-bot edit, a later one wins", async () => {
    const u = await user();
    const dev = randomUUID();
    const l = uid(), t = uid();
    await push(u.db, dev, [{ seq: 1, ...list(l), ts: ago(120) }, { seq: 2, ...task(t, l), ts: ago(120) }]);
    const w = await admin().rpc("server_write", { p_account: u.id, p_tbl: "tasks", p_id: t, p_fields: { title: "bot" } });
    expect(w.error).toBeNull();
    await push(u.db, dev, [{ seq: 3, tbl: "tasks", id: t, fields: { title: "old" }, ts: ago(60) }]);
    expect((await row(u.db, "tasks", t))?.title).toBe("bot");
    await push(u.db, dev, [{ seq: 4, tbl: "tasks", id: t, fields: { title: "new" }, ts: new Date(Date.now() + 60_000).toISOString() }]);
    expect((await row(u.db, "tasks", t))?.title).toBe("new");
  });
});
