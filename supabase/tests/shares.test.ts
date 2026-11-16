/*
 * Shares and RLS against the fixture of the v1.4 spec: an owner, a folder editor, a folder viewer,
 * a list-only member, a friend, a stranger and a blocked account. Run with `npm run test:server`.
 *
 * Owner's namespace:  folder F (shared: editor E, viewer V)
 *                       list A (also shared on its own: list-only editor L)
 *                       list B
 *                     list P (personal)
 */
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, ANON, folder, list, opts, pull, refusal, replica, row, rpc, send, task, uid, URL, user, type User } from "./helpers";

let O: User, E: User, V: User, L: User, Fr: User, S: User, K: User;
const F = uid(), A = uid(), B = uid(), P = uid();
const tA = uid(), tB = uid(), tP = uid();
let shareF: string, shareA: string;

async function invite(owner: User, share: string, member: User, role: "editor" | "viewer") {
  const code = await rpc<string>(owner.db, "create_share_invite", { p_share: share, p_role: role });
  await rpc(member.db, "redeem_invite", { p_code: code });
}

beforeAll(async () => {
  [O, E, V, L, Fr, S, K] = await Promise.all([user(), user(), user(), user(), user(), user(), user()]);
  const r = await send(O.db, folder(F), list(A, F), list(B, F), list(P), task(tA, A, { tags: '["o-tag"]', pinned: 1 }), task(tB, B), task(tP, P));
  expect(r.refused).toEqual([]);
  shareF = await rpc<string>(O.db, "create_share", { p_kind: "folder", p_container: F });
  shareA = await rpc<string>(O.db, "create_share", { p_kind: "list", p_container: A });
  await invite(O, shareF, E, "editor");
  await invite(O, shareF, V, "viewer");
  await invite(O, shareA, L, "editor");
  const code = await rpc<string>(O.db, "create_friend_invite");
  await rpc(Fr.db, "redeem_invite", { p_code: code });
  await rpc(O.db, "block_account", { p_account: K.id });
});

const keys = async (u: User, tbl: string) => [...(await replica(u.db)).keys()].filter((k) => k.startsWith(`${tbl}/`)).map((k) => k.slice(tbl.length + 1)).sort();
const sorted = (...ids: string[]) => [...ids].sort();

describe("who sees what", () => {
  it("the owner sees everything, members their part, everyone else nothing", async () => {
    expect(await keys(O, "lists")).toEqual(sorted(A, B, P));
    for (const m of [E, V]) {
      expect(await keys(m, "folders")).toEqual([F]);
      expect(await keys(m, "lists")).toEqual(sorted(A, B));
      expect(await keys(m, "tasks")).toEqual(sorted(tA, tB));
    }
    expect(await keys(L, "folders")).toEqual([]);
    expect(await keys(L, "lists")).toEqual([A]);
    expect(await keys(L, "tasks")).toEqual([tA]);
    for (const x of [Fr, S, K]) expect(await pull(x.db)).toEqual([]);
  });

  it("a list-only member sees the list at the top level, not in a folder it can't see", async () => {
    expect((await row(L.db, "lists", A))?.folder_id).toBeNull();
    expect((await row(E.db, "lists", A))?.folder_id).toBe(F);
  });

  it("can_access matches the role table", async () => {
    const can = (u: User, l: string, min: string) => rpc<boolean>(u.db, "can_access", { p_owner: O.id, p_list: l, p_min: min });
    expect(await can(O, P, "owner")).toBe(true);
    expect(await can(E, B, "editor")).toBe(true);
    expect(await can(E, B, "owner")).toBe(false);
    expect(await can(V, B, "viewer")).toBe(true);
    expect(await can(V, B, "editor")).toBe(false);
    expect(await can(L, A, "editor")).toBe(true);
    expect(await can(L, B, "viewer")).toBe(false);
    for (const x of [Fr, S, K]) expect(await can(x, A, "viewer")).toBe(false);
  });

  it("no table is readable outside its access", async () => {
    for (const x of [Fr, S, K]) {
      for (const t of ["sync_rows", "shares", "share_members", "task_personal", "container_placement", "sync_gone", "devices", "invites"]) {
        expect((await x.db.from(t).select("*")).data ?? []).toEqual([]);
      }
    }
    expect((await L.db.from("shares").select("id")).data).toEqual([{ id: shareA }]);
    expect((await E.db.from("shares").select("id")).data).toEqual([{ id: shareF }]);
    expect((await E.db.from("sync_rows").select("id")).data).toEqual([]);
  });

  it("no direct writes to sharing tables", async () => {
    expect((await S.db.from("share_members").insert({ share_id: shareF, account_id: S.id, role: "owner" })).error).not.toBeNull();
    expect((await S.db.from("shares").insert({ owner_id: S.id, kind: "list", container_id: "x" })).error).not.toBeNull();
    expect((await E.db.from("share_members").update({ role: "owner" }).eq("account_id", E.id).select()).data ?? []).toEqual([]);
  });
});

describe("roles", () => {
  it("editors change contents; viewers are refused and get the server's copy back", async () => {
    expect((await send(E.db, { tbl: "tasks", id: tB, fields: { title: "edited by E" } })).refused).toEqual([]);
    expect((await row(O.db, "tasks", tB))?.title).toBe("edited by E");
    const res = await send(V.db, { tbl: "tasks", id: tB, fields: { title: "edited by V" } });
    expect(res.refused?.[0]?.reason).toBe("read_only");
    expect((await row(O.db, "tasks", tB))?.title).toBe("edited by E");
    // The refused record was re-sent, so V's device overwrites its local edit.
    const latest = (await pull(V.db)).filter((r) => r.id === tB).at(-1);
    expect(latest?.data.title).toBe("edited by E");
  });

  it("a viewer's new task is refused and taken back from its device", async () => {
    const t = uid();
    expect((await send(V.db, task(t, B))).refused?.[0]?.reason).toBe("read_only");
    expect((await pull(V.db)).filter((r) => r.id === t).at(-1)?.data.deleted_at).toBeTruthy();
    expect(await row(O.db, "tasks", t)).toBeUndefined();
  });

  it("editors add tasks into the owner's namespace, stamped with who made them", async () => {
    const t = uid();
    expect((await send(E.db, task(t, B))).refused).toEqual([]);
    expect((await row(O.db, "tasks", t))?.created_by).toBe(E.id);
    expect((await admin().from("sync_rows").select("owner_id").eq("tbl", "tasks").eq("id", t)).data).toEqual([{ owner_id: O.id }]);
    expect(await row(V.db, "tasks", t)).toBeTruthy();
    expect(await row(L.db, "tasks", t)).toBeUndefined();
  });

  it("created_by and completed_by can't be forged; completing records who did it", async () => {
    await send(E.db, { tbl: "tasks", id: tB, fields: { status: "done", created_by: S.id, completed_by: S.id } });
    const r = await row(O.db, "tasks", tB);
    expect(r?.completed_by).toBe(E.id);
    expect(r?.created_by).toBe(O.id);
    await send(E.db, { tbl: "tasks", id: tB, fields: { status: "open" } });
    expect((await row(O.db, "tasks", tB))?.completed_by).toBeNull();
  });

  it("only the owner renames or deletes the share; editors rename lists inside it", async () => {
    expect((await send(E.db, { tbl: "folders", id: F, fields: { name: "mine now" } })).refused?.[0]?.reason).toBe("owner_only");
    expect((await send(E.db, { tbl: "folders", id: F, fields: { deleted_at: new Date().toISOString() } })).refused?.[0]?.reason).toBe("owner_only");
    expect((await send(L.db, { tbl: "lists", id: A, fields: { name: "renamed" } })).refused?.[0]?.reason).toBe("owner_only");
    expect((await send(E.db, { tbl: "lists", id: B, fields: { name: "B2" } })).refused).toEqual([]);
    expect((await row(V.db, "lists", B))?.name).toBe("B2");
  });

  it("a list-only member can't reach the folder's other lists", async () => {
    // Edits and creates aimed at a list it can't see are refused, and leave no stray copy.
    expect((await send(L.db, { tbl: "tasks", id: tB, fields: { title: "hijack" } })).refused?.[0]?.reason).toBe("no_access");
    expect((await row(O.db, "tasks", tB))?.title).not.toBe("hijack");
    expect((await send(L.db, task(uid(), B))).refused?.[0]?.reason).toBe("no_access");
    expect((await admin().from("sync_rows").select("id").eq("owner_id", L.id).eq("id", tB)).data).toEqual([]);
  });

  it("only editors and the owner can be assigned", async () => {
    expect((await send(E.db, { tbl: "tasks", id: tB, fields: { assignee_id: V.id } })).refused?.[0]?.reason).toBe("bad_assignee");
    expect((await send(E.db, { tbl: "tasks", id: tB, fields: { assignee_id: S.id } })).refused?.[0]?.reason).toBe("bad_assignee");
    expect((await send(E.db, { tbl: "tasks", id: tB, fields: { assignee_id: E.id } })).refused).toEqual([]);
    expect((await row(O.db, "tasks", tB))?.assignee_id).toBe(E.id);
  });
});

describe("personal layer", () => {
  it("tags, reminders and pins are per member and never reach the shared record", async () => {
    expect((await row(O.db, "tasks", tA))?.tags).toBe('["o-tag"]');
    expect((await row(E.db, "tasks", tA))?.tags).toBe("[]");
    expect((await send(E.db, { tbl: "tasks", id: tA, fields: { tags: '["e-tag"]', reminders: '["r"]', pinned: 1 } })).refused).toEqual([]);
    expect((await row(E.db, "tasks", tA))).toMatchObject({ tags: '["e-tag"]', reminders: '["r"]', pinned: 1 });
    expect((await row(O.db, "tasks", tA))).toMatchObject({ tags: '["o-tag"]', pinned: 1 });
    expect((await row(L.db, "tasks", tA))).toMatchObject({ tags: "[]", pinned: 0 });
    const stored = (await admin().from("sync_rows").select("data").eq("owner_id", O.id).eq("id", tA)).data?.[0]?.data;
    expect(stored).not.toHaveProperty("tags");
  });

  it("viewers keep a personal layer", async () => {
    expect((await send(V.db, { tbl: "tasks", id: tB, fields: { tags: '["v"]' } })).refused).toEqual([]);
    expect((await row(V.db, "tasks", tB))?.tags).toBe('["v"]');
  });

  it("list placement is personal, and a list-only member can file the list in their own folder", async () => {
    const mine = uid();
    await send(L.db, folder(mine));
    expect((await send(L.db, { tbl: "lists", id: A, fields: { folder_id: mine, pinned: 1 } })).refused).toEqual([]);
    expect(await row(L.db, "lists", A)).toMatchObject({ folder_id: mine, pinned: 1 });
    expect(await row(O.db, "lists", A)).toMatchObject({ folder_id: F, pinned: 0 });
  });
});

describe("moving across the boundary", () => {
  it("moving a task out is for its creator or the owner; its old audience loses it", async () => {
    const mine = uid();
    await send(E.db, list(mine));
    expect((await send(E.db, { tbl: "tasks", id: tB, fields: { list_id: mine } })).refused?.[0]?.reason).toBe("only_creator_moves_out");
    const t = uid();
    await send(E.db, task(t, B, { tags: '["x"]' }));
    expect(await row(V.db, "tasks", t)).toBeTruthy();
    expect((await send(E.db, { tbl: "tasks", id: t, fields: { list_id: mine } })).refused).toEqual([]);
    expect(await row(V.db, "tasks", t)).toBeUndefined();
    expect(await row(O.db, "tasks", t)).toBeUndefined();
    // E's personal tags come back into the record now that it's E's own.
    expect(await row(E.db, "tasks", t)).toMatchObject({ list_id: mine, tags: '["x"]' });
  });

  it("moving a personal task in shares it with the list's members, keeping personal fields personal", async () => {
    const t = uid();
    await send(O.db, task(t, P, { tags: '["secret"]' }));
    expect(await row(E.db, "tasks", t)).toBeUndefined();
    await send(O.db, { tbl: "tasks", id: t, fields: { list_id: B } });
    expect(await row(E.db, "tasks", t)).toMatchObject({ title: t, tags: "[]" });
    expect((await row(O.db, "tasks", t))?.tags).toBe('["secret"]');
  });

  it("an editor's personal list moved into the shared folder becomes the owner's", async () => {
    const l = uid(), t = uid();
    await send(E.db, list(l), task(t, l, { tags: '["e"]' }));
    expect((await send(E.db, { tbl: "lists", id: l, fields: { folder_id: F } })).refused).toEqual([]);
    expect(await row(V.db, "tasks", t)).toMatchObject({ tags: "[]" });
    expect(await row(E.db, "tasks", t)).toMatchObject({ tags: '["e"]' });
    expect((await admin().from("sync_rows").select("owner_id").eq("tbl", "lists").eq("id", l)).data).toEqual([{ owner_id: O.id }]);
  });

  it("only the owner moves a list out of the folder, and its members lose it", async () => {
    const l = uid(), t = uid();
    await send(O.db, list(l, F), task(t, l));
    expect(await row(V.db, "tasks", t)).toBeTruthy();
    expect((await send(E.db, { tbl: "lists", id: l, fields: { folder_id: null } })).refused?.[0]?.reason).toBe("owner_only");
    expect((await send(O.db, { tbl: "lists", id: l, fields: { folder_id: null } })).refused).toEqual([]);
    expect(await row(V.db, "lists", l)).toBeUndefined();
    expect(await row(E.db, "lists", l)).toBeUndefined();
    expect(await row(O.db, "tasks", t)).toBeTruthy();
  });

  it("a personal folder can't go into a shared one", async () => {
    const pf = uid();
    await send(O.db, folder(pf));
    expect((await send(O.db, { tbl: "folders", id: pf, fields: { parent_id: F } })).refused?.[0]?.reason).toBe("personal_folder_into_share");
    expect((await row(O.db, "folders", pf))?.parent_id).toBeNull();
  });

  it("the audience call names who gains access", async () => {
    const who = await rpc<{ account_id: string }[]>(O.db, "audience", { p_kind: "list", p_id: A });
    expect(who.map((w) => w.account_id).sort()).toEqual([E.id, V.id, L.id].sort());
  });
});

describe("membership", () => {
  it("invitations from the friend list wait for the friend to accept", async () => {
    const l = uid();
    await send(O.db, list(l));
    const s = await rpc<string>(O.db, "create_share", { p_kind: "list", p_container: l });
    expect(await refusal(O.db, "invite_to_share", { p_share: s, p_friend: S.id, p_role: "editor" })).toContain("not_friends");
    await rpc(O.db, "invite_to_share", { p_share: s, p_friend: Fr.id, p_role: "editor" });
    expect(await row(Fr.db, "lists", l)).toBeUndefined();
    const mine = await rpc<{ share_id: string; status: string }[]>(Fr.db, "my_shares");
    expect(mine).toContainEqual(expect.objectContaining({ share_id: s, status: "invited" }));
    await rpc(Fr.db, "respond_share", { p_share: s, p_accept: true });
    expect(await row(Fr.db, "lists", l)).toBeTruthy();
  });

  it("only the owner manages members; the owner must transfer before leaving", async () => {
    expect(await refusal(E.db, "remove_member", { p_share: shareF, p_account: V.id })).toContain("owner_only");
    expect(await refusal(O.db, "remove_member", { p_share: shareF, p_account: O.id })).toContain("transfer_first");
    expect(await refusal(E.db, "create_share_invite", { p_share: shareF, p_role: "editor" })).toContain("owner_only");
    expect(await refusal(E.db, "set_member_role", { p_share: shareF, p_account: E.id, p_role: "editor" })).toContain("owner_only");
  });

  it("losing access purges the records, the personal layer and assignments", async () => {
    const x = await user();
    await invite(O, shareF, x, "editor");
    const t = uid();
    await send(x.db, task(t, B, { tags: '["x"]' }));
    await send(E.db, { tbl: "tasks", id: t, fields: { assignee_id: x.id } });
    expect((await row(x.db, "tasks", t))?.tags).toBe('["x"]');
    await rpc(x.db, "remove_member", { p_share: shareF, p_account: x.id });
    expect(await keys(x, "lists")).toEqual([]);
    expect(await keys(x, "folders")).toEqual([]);
    expect((await row(O.db, "tasks", t))?.assignee_id).toBeNull();
    expect((await admin().from("task_personal").select("*").eq("account_id", x.id)).data).toEqual([]);
  });

  it("links expire, can be revoked by their creator only, and blocked accounts can't use them", async () => {
    const code = await rpc<string>(O.db, "create_share_invite", { p_share: shareA, p_role: "viewer" });
    expect(await refusal(E.db, "revoke_invite", { p_code: code })).toContain("no_such_invite");
    expect(await refusal(K.db, "redeem_invite", { p_code: code })).toContain("invite_invalid");
    expect(await rpc<unknown[]>(K.db, "invite_info", { p_code: code })).toEqual([]);
    await rpc(O.db, "revoke_invite", { p_code: code });
    expect(await refusal(S.db, "redeem_invite", { p_code: code })).toContain("invite_invalid");
    const old = await rpc<string>(O.db, "create_share_invite", { p_share: shareA, p_role: "viewer" });
    await admin().from("invites").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("code", old);
    expect(await refusal(S.db, "redeem_invite", { p_code: old })).toContain("invite_invalid");
    const info = await rpc<{ kind: string; role: string; expires_at: string }[]>(S.db, "invite_info", {
      p_code: await rpc<string>(O.db, "create_share_invite", { p_share: shareA, p_role: "editor" }),
    });
    expect(info[0]).toMatchObject({ kind: "share", role: "editor" });
    expect(new Date(info[0].expires_at).getTime()).toBeLessThan(Date.now() + 14.01 * 86_400_000);
  });

  it("share members see each other through share_people, never the profile row (SOC-13); strangers see nothing", async () => {
    expect((await E.db.from("profiles").select("id").eq("id", L.id)).data).toEqual([]);
    expect((await E.db.from("profiles").select("id").eq("id", V.id)).data).toEqual([]);
    expect((await S.db.from("profiles").select("id").eq("id", O.id)).data).toEqual([]);
    const people = await rpc<{ account_id: string; role: string }[]>(E.db, "share_people", { p_share: shareF });
    expect(people[0]).toMatchObject({ account_id: O.id, role: "owner" });
    expect(await rpc<unknown[]>(S.db, "share_people", { p_share: shareF })).toEqual([]);
  });

  it("caps distinct people across the tree at the plan's member limit", async () => {
    expect(await rpc(S.db, "plan_limits", { p_account: S.id })).toMatchObject({ plan: "pro", share_members: 25 });
    const c = await user();
    const l = uid();
    await send(c.db, list(l));
    const s = await rpc<string>(c.db, "create_share", { p_kind: "list", p_container: l });
    const people = await Promise.all(Array.from({ length: 25 }, () => user(false)));
    for (const p of people.slice(0, 24)) await invite(c, s, p, "viewer");
    const msg = await refusal(people[24].db, "redeem_invite", { p_code: await rpc<string>(c.db, "create_share_invite", { p_share: s, p_role: "viewer" }) });
    expect(msg).toContain("too_many_members");
  }, 60_000);
});

describe("ownership", () => {
  it("transfers to a member with the records, and the old owner stays as an editor", async () => {
    const o = await user(), m = await user();
    const f = uid(), l = uid(), t = uid();
    await send(o.db, folder(f), list(l, f), task(t, l));
    const s = await rpc<string>(o.db, "create_share", { p_kind: "folder", p_container: f });
    await invite(o, s, m, "editor");
    expect(await refusal(m.db, "transfer_share", { p_share: s, p_to: m.id })).toContain("owner_only");
    await rpc(o.db, "transfer_share", { p_share: s, p_to: m.id });
    expect((await admin().from("sync_rows").select("owner_id").eq("id", t)).data).toEqual([{ owner_id: m.id }]);
    expect(await row(o.db, "tasks", t)).toBeTruthy();
    expect((await send(o.db, { tbl: "folders", id: f, fields: { name: "x" } })).refused?.[0]?.reason).toBe("owner_only");
    expect(await rpc(m.db, "my_shares")).toContainEqual(expect.objectContaining({ share_id: s, role: "owner" }));
  });

  it("passes to the longest-standing editor when the owner's account is deleted", async () => {
    const o = await user(), first = await user(), second = await user();
    const l = uid(), t = uid();
    await send(o.db, list(l), task(t, l));
    const s = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    await invite(o, s, first, "editor");
    await invite(o, s, second, "editor");
    await rpc(o.db, "request_account_deletion");
    await admin().from("account_deletions").update({ requested_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("owner_id", o.id);
    expect((await admin().rpc("purge_deleted")).error).toBeNull();
    expect(await rpc(first.db, "my_shares")).toContainEqual(expect.objectContaining({ share_id: s, role: "owner" }));
    expect(await row(second.db, "tasks", t)).toBeTruthy();
  });

  it("stopping sharing takes it from every member", async () => {
    const o = await user(), m = await user();
    const l = uid(), t = uid();
    await send(o.db, list(l), task(t, l, { tags: '["o"]' }));
    const s = await rpc<string>(o.db, "create_share", { p_kind: "list", p_container: l });
    await invite(o, s, m, "viewer");
    expect(await row(m.db, "tasks", t)).toBeTruthy();
    await rpc(o.db, "delete_share", { p_share: s });
    expect(await row(m.db, "lists", l)).toBeUndefined();
    const stored = (await admin().from("sync_rows").select("data").eq("owner_id", o.id).eq("id", t)).data?.[0]?.data;
    expect(stored).toMatchObject({ tags: '["o"]' });
  });
});

describe("attachments", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const up = (u: User, path: string) => u.db.storage.from("attachments").upload(path, png, { contentType: "image/png", upsert: false });

  it("editors upload, members read with signed URLs, everyone else is refused", async () => {
    const pathB = `share/${shareF}/${B}/${uid()}.png`;
    expect((await up(E, pathB)).error).toBeNull();
    expect((await up(V, `share/${shareF}/${B}/${uid()}.png`)).error).not.toBeNull();
    expect((await up(S, `share/${shareF}/${B}/${uid()}.png`)).error).not.toBeNull();
    const signed = await V.db.storage.from("attachments").createSignedUrl(pathB, 3600);
    expect(signed.error).toBeNull();
    for (const x of [L, Fr, S, K]) expect((await x.db.storage.from("attachments").createSignedUrl(pathB, 3600)).error).not.toBeNull();
    // A list-only member reaches its own list's files.
    const pathA = `share/${shareA}/${A}/${uid()}.png`;
    expect((await up(L, pathA)).error).toBeNull();
    expect((await L.db.storage.from("attachments").download(pathA)).error).toBeNull();
    expect((await up(E, `user/${E.id}/${uid()}.png`)).error).not.toBeNull();
  });

  // Note images (D291): `notes/<file>`, readable by whoever can see a task that references it.
  it("note images follow the tasks that reference them", async () => {
    const img = `${uid()}.png`, other = `${uid()}.png`, tN = uid(), tQ = uid();
    const note = (f: string) => ({ description: `see ![](attachment:${f})` });
    expect((await send(O.db, task(tN, B, note(img)), task(tQ, P, note(other)))).refused).toEqual([]);
    const get = (u: User, f: string) => u.db.storage.from("attachments").download(`notes/${f}`);
    // Uploading needs a referencing task you can edit; a second upload of the same name is a duplicate.
    expect((await up(O, `notes/${uid()}.png`)).error).not.toBeNull();
    expect((await up(V, `notes/${img}`)).error).not.toBeNull();
    expect((await up(O, `notes/${img}`)).error).toBeNull();
    expect((await up(E, `notes/${img}`)).error).not.toBeNull();
    expect((await up(O, `notes/${other}`)).error).toBeNull();
    // Members of a share covering the task read it; nobody else does, and personal tasks stay private.
    for (const x of [O, E, V]) expect((await get(x, img)).error).toBeNull();
    for (const x of [L, Fr, S, K]) expect((await get(x, img)).error).not.toBeNull();
    expect((await get(E, other)).error).not.toBeNull();
    // Naming the file in a task of your own grants nothing: the uploader can't see that task.
    const sl = uid();
    await send(S.db, list(sl), task(uid(), sl, note(img)));
    expect((await get(S, img)).error).not.toBeNull();
    // Access moves with the task.
    await send(O.db, { tbl: "tasks", id: tN, fields: { list_id: P } });
    expect((await get(V, img)).error).not.toBeNull();
    expect((await get(O, img)).error).toBeNull();
  });

  it("refuses anything but images", async () => {
    const r = await E.db.storage.from("attachments").upload(`share/${shareF}/${B}/${uid()}.svg`, "<svg/>", { contentType: "image/svg+xml" });
    expect(r.error).not.toBeNull();
  });

  it("signed-out callers get nothing", async () => {
    const anon = createClient(URL, ANON, opts);
    expect((await anon.storage.from("attachments").list(`share/${shareF}`)).data ?? []).toEqual([]);
    expect((await anon.rpc("my_shares")).error).not.toBeNull();
  });
});
