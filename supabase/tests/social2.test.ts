/*
 * v1.2.4 social findings, second pass (supabase/migrations/20261116040000_social_links_blocks.sql).
 * Run with `npm run test:server`.
 */
import { describe, expect, it } from "vitest";
import { admin, list, refusal, row, rpc, send, task, uid, user, type User } from "./helpers";

async function friends() {
  const [a, b] = await Promise.all([user(), user()]);
  await rpc(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") });
  return { a, b };
}
async function sharedList(owner: User, members: { u: User; role: "editor" | "viewer" }[]) {
  const l = uid();
  await send(owner.db, list(l), task(uid(), l));
  const share = await rpc<string>(owner.db, "create_share", { p_kind: "list", p_container: l });
  for (const m of members) await rpc(m.u.db, "redeem_invite", { p_code: await rpc<string>(owner.db, "create_share_invite", { p_share: share, p_role: m.role }) });
  return { l, share };
}

describe("SOC-03: blocking cuts shared access both ways", () => {
  it("removes the blocked account from the blocker's shares and the blocker from theirs", async () => {
    const { a, b } = await friends();
    const mine = await sharedList(a, [{ u: b, role: "editor" }]);
    const theirs = await sharedList(b, [{ u: a, role: "viewer" }]);
    await rpc(a.db, "block_account", { p_account: b.id });
    expect(await row(b.db, "lists", mine.l)).toBeUndefined();
    expect(await row(a.db, "lists", theirs.l)).toBeUndefined();
    expect((await rpc<unknown[]>(a.db, "my_shares")).filter((s) => (s as { role: string }).role !== "owner")).toEqual([]);
    expect((await b.db.from("profiles").select("id").eq("id", a.id)).data).toEqual([]);
  });
});

describe("SOC-04 / SOC-05: link limits and revoking", () => {
  it("a share link works once by default, then reads as invalid", async () => {
    const [o, x, y] = await Promise.all([user(), user(), user()]);
    const l = uid();
    await send(o.db, list(l));
    const share = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    const code = await rpc<string>(o.db, "create_share_invite", { p_share: share, p_role: "viewer" });
    await rpc(x.db, "redeem_invite", { p_code: code });
    expect(await refusal(y.db, "redeem_invite", { p_code: code })).toContain("invite_invalid");
    expect(await rpc<unknown[]>(y.db, "invite_info", { p_code: code })).toEqual([]);
  });

  it("a friend link with max_uses stops at the limit; the owner's list shows live links only", async () => {
    const [a, x, y] = await Promise.all([user(), user(), user()]);
    const code = await rpc<string>(a.db, "create_friend_invite", { p_max_uses: 1 });
    const open = await rpc<string>(a.db, "create_friend_invite");
    expect((await rpc<{ code: string; max_uses: number | null }[]>(a.db, "my_invites")).map((i) => i.code).sort()).toEqual([code, open].sort());
    await rpc(x.db, "redeem_invite", { p_code: code });
    expect(await refusal(y.db, "redeem_invite", { p_code: code })).toContain("invite_invalid");
    expect((await rpc<{ code: string }[]>(a.db, "my_invites")).map((i) => i.code)).toEqual([open]);
    await rpc(a.db, "revoke_invite", { p_code: open });
    expect(await rpc<unknown[]>(a.db, "my_invites")).toEqual([]);
  });

  it("an unlimited link is multi-use, and a removed member can't rejoin with a link made before", async () => {
    const [o, m] = await Promise.all([user(), user()]);
    const l = uid();
    await send(o.db, list(l));
    const share = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    const code = await rpc<string>(o.db, "create_share_invite", { p_share: share, p_role: "editor", p_max_uses: null });
    await rpc(m.db, "redeem_invite", { p_code: code });
    await rpc(o.db, "remove_member", { p_share: share, p_account: m.id });
    expect(await refusal(m.db, "redeem_invite", { p_code: code })).toContain("invite_invalid");
    // A link made after the removal is the owner's new decision.
    const fresh = await rpc<string>(o.db, "create_share_invite", { p_share: share, p_role: "viewer" });
    await rpc(m.db, "redeem_invite", { p_code: fresh });
    expect(await row(m.db, "lists", l)).toBeDefined();
  });

  it("links last 14 days", async () => {
    const a = await user();
    await rpc(a.db, "create_friend_invite");
    const [i] = await rpc<{ expires_at: string }[]>(a.db, "my_invites");
    const t = new Date(i.expires_at).getTime();
    expect(t).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(t).toBeLessThan(Date.now() + 14.01 * 86_400_000);
  });
});

describe("SOC-06 / SOC-07: link codes and connection permission", () => {
  it("codes are 8 digits and a new chat starts add-only", async () => {
    const u = await user();
    expect(await rpc<string>(u.db, "create_link_code")).toMatch(/^\d{8}$/);
    const code = await rpc<string>(u.db, "create_link_code");
    await rpc(admin(), "link_chat", { p_code: code, p_source: "telegram", p_external: uid(), p_label: null, p_reply: {} });
    expect((await rpc<{ permission: string }[]>(u.db, "my_connections"))[0].permission).toBe("add");
  });
});

describe("SOC-09: editors can't push values the apps refuse", () => {
  it("refuses a task with priority 99 or an unknown status in a shared list", async () => {
    const [o, e] = await Promise.all([user(), user()]);
    const { l } = await sharedList(o, [{ u: e, role: "editor" }]);
    const t = uid();
    const r = await send(e.db, task(t, l, { priority: 99 }), task(uid(), l, { status: "nope" }), task(uid(), l, { priority: 2 }));
    expect(r.refused?.map((x) => x.reason)).toEqual([expect.stringContaining("bad_value"), expect.stringContaining("bad_value")]);
  });
});

describe("SOC-11: blocked list", () => {
  it("my_blocks lists who you blocked, and unblock removes them", async () => {
    const { a, b } = await friends();
    await rpc(a.db, "block_account", { p_account: b.id });
    expect(await rpc(a.db, "my_blocks")).toEqual([expect.objectContaining({ id: b.id, handle: b.handle })]);
    await rpc(a.db, "unblock_account", { p_account: b.id });
    expect(await rpc<unknown[]>(a.db, "my_blocks")).toEqual([]);
  });
});

describe("SOC-12: request privacy and limits", () => {
  it("an account that isn't taking requests looks like no account", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    await b.db.from("profiles").update({ allow_requests: "none" }).eq("id", b.id);
    expect(await rpc(a.db, "request_friend", { p_handle: b.handle })).toBe("no_such_account");
    expect(await rpc<unknown[]>(a.db, "find_profile", { p_handle: b.handle })).toEqual([]);
    // A link still works: it is the owner's own choice to hand one out.
    await rpc(a.db, "redeem_invite", { p_code: await rpc<string>(b.db, "create_friend_invite") });
  });

  it("lookups are limited to 60 an hour", async () => {
    const a = await user();
    for (let i = 0; i < 60; i++) await rpc(a.db, "find_profile", { p_handle: "nobody_here_x" });
    expect(await refusal(a.db, "find_profile", { p_handle: "nobody_here_x" })).toContain("too_many_requests");
  }, 60_000);
});

describe("SOC-13: invited members are not listed to other members", () => {
  it("a member sees the owner and active members; the owner also sees the invited", async () => {
    const [o, m, inv] = await Promise.all([user(), user(), user()]);
    for (const x of [m, inv]) await rpc(x.db, "redeem_invite", { p_code: await rpc<string>(o.db, "create_friend_invite") });
    const { share } = await sharedList(o, [{ u: m, role: "editor" }]);
    await rpc(o.db, "invite_to_share", { p_share: share, p_friend: inv.id, p_role: "viewer" });
    const ids = async (u: User) => (await rpc<{ account_id: string }[]>(u.db, "share_people", { p_share: share })).map((p) => p.account_id).sort();
    expect(await ids(m)).toEqual([o.id, m.id].sort());
    expect(await ids(o)).toEqual([o.id, m.id, inv.id].sort());
  });
});

describe("SOC-15: task_activity edits need editor where the row lives now", () => {
  it("a viewer of list B can't repoint B's activity at a task of list A", async () => {
    const [o, e] = await Promise.all([user(), user()]);
    const a = await sharedList(o, [{ u: e, role: "editor" }]);
    const b = await sharedList(o, [{ u: e, role: "viewer" }]);
    const tA = uid(), tB = uid(), act = uid();
    await send(o.db, task(tA, a.l), task(tB, b.l), { tbl: "task_activity", id: act, fields: { id: act, task_id: tB, at: new Date().toISOString(), kind: "created", detail: "orig", deleted_at: null } });
    await send(e.db, { tbl: "task_activity", id: act, fields: { task_id: tA, detail: "pwned" } });
    const { data } = await admin().from("sync_rows").select("data").eq("owner_id", o.id).eq("tbl", "task_activity").eq("id", act).single();
    expect(data?.data).toMatchObject({ task_id: tB, detail: "orig" });
  });
});

describe("SOC-19 / SOC-20", () => {
  it("a buddy can leave a habit", async () => {
    const { a, b } = await friends();
    const h = uid();
    await send(a.db, { tbl: "habits", id: h, fields: { id: h, name: "Read", deleted_at: null } });
    await rpc(a.db, "set_buddies", { p_habit: h, p_buddies: [b.id], p_nudges: true });
    expect(await rpc<unknown[]>(b.db, "buddy_habits")).toHaveLength(1);
    await rpc(b.db, "buddy_decline", { p_owner: a.id, p_habit: h });
    expect(await rpc<unknown[]>(b.db, "buddy_habits")).toEqual([]);
    expect(await rpc<unknown[]>(a.db, "my_buddies")).toEqual([]);
  });

  it("share invitations to one friend are limited to 5 a day", async () => {
    const { a, b } = await friends();
    const ids = Array.from({ length: 6 }, () => uid());
    const shares: string[] = [];
    for (const l of ids) {
      await send(a.db, list(l));
      shares.push(await rpc<string>(a.db, "create_share", { p_kind: "list", p_container: l }));
    }
    for (const s of shares.slice(0, 5)) await rpc(a.db, "invite_to_share", { p_share: s, p_friend: b.id, p_role: "viewer" });
    expect(await refusal(a.db, "invite_to_share", { p_share: shares[5], p_friend: b.id, p_role: "viewer" })).toContain("too_many_invites");
  });
});

describe("SOC-10: report limits", () => {
  it("a signed-in account can file 20 reports a day", async () => {
    const a = await user();
    const report = () => a.db.from("reports").insert({ name: "x", email: "a@example.test", body: "Spam spam spam spam", app_version: "1", platform: "test" });
    for (let i = 0; i < 20; i++) expect((await report()).error).toBeNull();
    expect((await report()).error?.message).toContain("too_many_reports");
  }, 60_000);
});
