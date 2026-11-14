/* Sent tasks, Focus together, check-in buddies and nudges (v1.4, D260). Run with `npm run test:server`. */
import { beforeAll, describe, expect, it } from "vitest";
import { admin, pull, refusal, replica, rpc, send, uid, user, type User } from "./helpers";

let a: User, b: User, s: User;
beforeAll(async () => {
  [a, b, s] = await Promise.all([user(), user(), user()]);
  await rpc(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") });
});

const sendTask = (from: User, to: User, payload: Record<string, unknown>) =>
  admin().rpc("send_task", { p_sender: from.id, p_recipient: to.id, p_payload: payload });

describe("sent tasks", () => {
  it("only friends, and only the server path, can send", async () => {
    expect((await sendTask(a, s, { title: "x" })).error?.message).toContain("not_friends");
    expect((await a.db.rpc("send_task", { p_sender: a.id, p_recipient: b.id, p_payload: { title: "x" } })).error).not.toBeNull();
    expect((await a.db.from("sent_tasks").insert({ sender: a.id, recipient: b.id, payload: {} })).error).not.toBeNull();
  });

  it("accepting copies title, note, checklist and subtasks into the Inbox; the sender sees only the outcome", async () => {
    const { data: id, error } = await sendTask(a, b, {
      title: "Review PR", description: "the auth one", checklist: '[{"text":"read","done":false}]',
      subtasks: [{ title: "Run tests" }, { title: "Approve" }], list_id: "hijack", secret: "dropped",
    });
    expect(error).toBeNull();
    const incoming = await rpc<{ id: string; handle: string; payload: Record<string, unknown> }[]>(b.db, "incoming_tasks");
    expect(incoming).toEqual([expect.objectContaining({ id, handle: a.handle })]);
    expect(incoming[0].payload).not.toHaveProperty("secret");
    const taskId = await rpc<string>(b.db, "respond_sent_task", { p_id: id, p_accept: true });
    const rows = await replica(b.db);
    expect(rows.get(`tasks/${taskId}`)).toMatchObject({ title: "Review PR", description: "the auth one", list_id: "inbox", status: "open" });
    const kids = [...rows.values()].filter((r) => r.parent_id === taskId).map((r) => r.title);
    expect(kids.sort()).toEqual(["Approve", "Run tests"]);
    expect(await rpc(a.db, "outgoing_tasks")).toEqual([expect.objectContaining({ id, title: "Review PR", status: "accepted" })]);
    // The copies aren't connected: nothing of B's reaches A.
    expect((await pull(a.db)).find((r) => r.id === taskId)).toBeUndefined();
    expect(await refusal(b.db, "respond_sent_task", { p_id: id, p_accept: true })).toContain("no_such_request");
  });

  it("declining adds nothing, and only the recipient can answer", async () => {
    const { data: id } = await sendTask(a, b, { title: "Nope" });
    expect(await refusal(s.db, "respond_sent_task", { p_id: id, p_accept: true })).toContain("no_such_request");
    expect(await refusal(a.db, "respond_sent_task", { p_id: id, p_accept: true })).toContain("no_such_request");
    const before = (await pull(b.db)).length;
    expect(await rpc(b.db, "respond_sent_task", { p_id: id, p_accept: false })).toBeNull();
    expect((await pull(b.db)).length).toBe(before);
    expect((await s.db.from("sent_tasks").select("id")).data).toEqual([]);
  });
});

describe("focus together", () => {
  it("publishes only to friends, only when switched on, and only the end time", async () => {
    const ends = new Date(Date.now() + 25 * 60_000).toISOString();
    await rpc(a.db, "set_focus", { p_ends_at: ends });
    expect((await b.db.from("focus_status").select("*").eq("account_id", a.id)).data).toEqual([]);
    await a.db.from("profiles").update({ share_focus: true }).eq("id", a.id);
    await rpc(a.db, "set_focus", { p_ends_at: ends });
    const seen = (await b.db.from("focus_status").select("*").eq("account_id", a.id)).data;
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen![0]).sort()).toEqual(["account_id", "ends_at", "updated_at"]);
    expect((await s.db.from("focus_status").select("*").eq("account_id", a.id)).data).toEqual([]);
    // Turning the setting off takes the session off the air.
    await a.db.from("profiles").update({ share_focus: false }).eq("id", a.id);
    expect((await a.db.from("focus_status").select("ends_at").eq("account_id", a.id)).data).toEqual([{ ends_at: null }]);
    expect(await refusal(a.db, "set_focus", { p_ends_at: new Date(Date.now() - 1000).toISOString() })).toContain("bad_end");
  });

  it("hides your session from someone who blocked or unfriended you", async () => {
    const [x, y] = await Promise.all([user(), user()]);
    await rpc(y.db, "redeem_invite", { p_code: await rpc<string>(x.db, "create_friend_invite") });
    await x.db.from("profiles").update({ share_focus: true }).eq("id", x.id);
    await rpc(x.db, "set_focus", { p_ends_at: new Date(Date.now() + 60_000).toISOString() });
    expect((await y.db.from("focus_status").select("account_id")).data).toHaveLength(1);
    await rpc(x.db, "block_account", { p_account: y.id });
    expect((await y.db.from("focus_status").select("account_id")).data).toEqual([]);
  });
});

describe("check-in buddies", () => {
  const habit = uid();
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await a.db.from("profiles").update({ time_zone: "UTC" }).eq("id", a.id);
    await send(a.db,
      { tbl: "habits", id: habit, fields: { id: habit, name: "Read", goal: '{"kind":"count","target":3}', deleted_at: null } },
      { tbl: "habit_checkins", id: `${habit}|${today}`, fields: { habit_id: habit, date: today, _delta: 2, deleted_at: null } },
      { tbl: "habits", id: "other", fields: { id: "other", name: "Private habit", deleted_at: null } },
    );
  });

  it("only friends can be buddies, and see the name and today's check-in only", async () => {
    expect(await refusal(a.db, "set_buddies", { p_habit: habit, p_buddies: [s.id] })).toContain("not_friends");
    await rpc(a.db, "set_buddies", { p_habit: habit, p_buddies: [b.id] });
    const seen = await rpc<Record<string, unknown>[]>(b.db, "buddy_habits");
    expect(seen).toEqual([{ owner_id: a.id, handle: a.handle, display_name: a.handle, habit_id: habit, name: "Read", today: 2, can_nudge: true }]);
    expect(await rpc(s.db, "buddy_habits")).toEqual([]);
    expect(await refusal(b.db, "set_buddies", { p_habit: habit, p_buddies: [] })).toContain("no_such_habit");
  });

  it("a buddy nudges at most once a day; the owner can switch nudges off", async () => {
    expect(await refusal(s.db, "nudge", { p_owner: a.id, p_habit: habit })).toContain("not_a_buddy");
    await rpc(b.db, "nudge", { p_owner: a.id, p_habit: habit });
    expect(await refusal(b.db, "nudge", { p_owner: a.id, p_habit: habit })).toContain("already_nudged");
    expect((await a.db.from("nudges").select("from_id, habit_id")).data).toEqual([{ from_id: b.id, habit_id: habit }]);
    expect((await b.db.from("nudges").select("*")).data).toEqual([]);
    expect((await rpc<{ can_nudge: boolean }[]>(b.db, "buddy_habits"))[0].can_nudge).toBe(false);
    await rpc(a.db, "set_buddies", { p_habit: habit, p_buddies: [b.id], p_nudges: false });
    await admin().from("nudges").delete().eq("to_id", a.id);
    expect(await refusal(b.db, "nudge", { p_owner: a.id, p_habit: habit })).toContain("nudges_off");
  });

  it("ending the friendship ends the view", async () => {
    await rpc(b.db, "remove_friend", { p_account: a.id });
    expect(await rpc(b.db, "buddy_habits")).toEqual([]);
    expect(await refusal(b.db, "nudge", { p_owner: a.id, p_habit: habit })).toContain("not_a_buddy");
  });
});
