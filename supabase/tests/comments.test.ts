/*
 * Comments follow their task when the share's owner changes or the task changes namespace
 * (20261118020000_comments_follow_owner.sql). Run with `npm run test:server`.
 */
import { describe, expect, it } from "vitest";
import { admin, folder, list, rpc, send, task, uid, user, type User } from "./helpers";

async function invite(owner: User, share: string, member: User, role: "editor" | "viewer") {
  const code = await rpc<string>(owner.db, "create_share_invite", { p_share: share, p_role: role });
  await rpc(member.db, "redeem_invite", { p_code: code });
}
const bodies = async (u: User, t: string) => (await rpc<{ body: string }[]>(u.db, "task_comments", { p_task: t })).map((c) => c.body);
const ownerOf = async (t: string) => (await admin().from("task_comments").select("owner_id").eq("task_id", t)).data?.map((c) => c.owner_id);

describe("comments follow their task", () => {
  it("survive transfer_share, a second transfer and the nightly purge", async () => {
    const [o, e] = await Promise.all([user(), user()]);
    const f = uid(), l = uid(), t = uid();
    await send(o.db, folder(f), list(l, f), task(t, l));
    const s = await rpc<string>(o.db, "create_share", { p_kind: "folder", p_container: f });
    await invite(o, s, e, "editor");
    await rpc(e.db, "add_task_comment", { p_task: t, p_body: "hello" });

    await rpc(o.db, "transfer_share", { p_share: s, p_to: e.id });
    expect(await ownerOf(t)).toEqual([e.id]);
    expect(await bodies(e, t)).toEqual(["hello"]);
    expect(await bodies(o, t)).toEqual(["hello"]);

    await rpc(e.db, "transfer_share", { p_share: s, p_to: o.id }); // and back again
    await rpc(admin(), "purge_comments");
    expect(await ownerOf(t)).toEqual([o.id]);
    expect(await bodies(o, t)).toEqual(["hello"]);
  });

  it("survive the owner's account deletion", async () => {
    const [o, e] = await Promise.all([user(), user()]);
    const f = uid(), l = uid(), t = uid();
    await send(o.db, folder(f), list(l, f), task(t, l));
    await invite(o, await rpc<string>(o.db, "create_share", { p_kind: "folder", p_container: f }), e, "editor");
    await rpc(e.db, "add_task_comment", { p_task: t, p_body: "kept" });
    await rpc(o.db, "request_account_deletion");
    await admin().from("account_deletions").update({ requested_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("owner_id", o.id);
    expect((await admin().rpc("purge_deleted")).error).toBeNull(); // passes the share to the editor, then removes the account
    await rpc(admin(), "purge_comments");
    expect(await bodies(e, t)).toEqual(["kept"]);
  });

  it("follow a task an editor moves out of the shared list into their own", async () => {
    const [o, e] = await Promise.all([user(), user()]);
    const f = uid(), l = uid(), mine = uid(), t = uid();
    await send(o.db, folder(f), list(l, f));
    await invite(o, await rpc<string>(o.db, "create_share", { p_kind: "folder", p_container: f }), e, "editor");
    await send(e.db, list(mine), task(t, l));
    await rpc(e.db, "add_task_comment", { p_task: t, p_body: "moves" });
    expect((await send(e.db, { tbl: "tasks", id: t, fields: { list_id: mine } })).refused).toEqual([]);
    expect(await ownerOf(t)).toEqual([e.id]);
    await rpc(admin(), "purge_comments");
    expect(await ownerOf(t)).toEqual([e.id]);
  });
});
