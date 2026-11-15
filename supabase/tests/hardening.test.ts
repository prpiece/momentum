/* v1.2.4 test findings SOC-02, SOC-09, SOC-14 (migration 20261116010000). Run with `npm run test:server`. */
import { describe, expect, it } from "vitest";
import { admin, list, refusal, rpc, send, uid, user } from "./helpers";

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
