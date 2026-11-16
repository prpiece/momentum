/* Friends, requests, blocks and friend links (v1.4, D260, D261). Run with `npm run test:server`. */
import { describe, expect, it } from "vitest";
import { admin, refusal, rpc, user, type User } from "./helpers";

const friends = (u: User) => rpc<{ id: string; status: string; incoming: boolean }[]>(u.db, "my_friends");

describe("requests", () => {
  it("is mutual: a request waits until the other side accepts", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    expect(await rpc(a.db, "request_friend", { p_handle: b.handle })).toBe("pending");
    expect(await friends(b)).toEqual([expect.objectContaining({ id: a.id, status: "pending", incoming: true })]);
    expect(await friends(a)).toEqual([expect.objectContaining({ id: b.id, status: "pending", incoming: false })]);
    expect(await refusal(a.db, "respond_friend", { p_account: b.id, p_accept: true })).toContain("no_such_request");
    await rpc(b.db, "respond_friend", { p_account: a.id, p_accept: true });
    expect(await friends(a)).toEqual([expect.objectContaining({ id: b.id, status: "accepted" })]);
    expect(await rpc(a.db, "request_friend", { p_handle: b.handle })).toBe("friends");
  });

  it("asking someone who already asked you makes you friends", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    await rpc(a.db, "request_friend", { p_handle: b.handle });
    expect(await rpc(b.db, "request_friend", { p_handle: a.handle })).toBe("accepted");
  });

  it("waits 7 days after a decline", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    await rpc(a.db, "request_friend", { p_handle: b.handle });
    await rpc(b.db, "respond_friend", { p_account: a.id, p_accept: false });
    expect(await friends(a)).toEqual([]);
    expect(await refusal(a.db, "request_friend", { p_handle: b.handle })).toContain("declined_recently");
    await admin().from("friend_declines").update({ at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("from_id", a.id);
    expect(await rpc(a.db, "request_friend", { p_handle: b.handle })).toBe("pending");
  });

  it("allows 20 requests a day", async () => {
    const a = await user();
    const others = await Promise.all(Array.from({ length: 21 }, () => user()));
    for (const o of others.slice(0, 20)) await rpc(a.db, "request_friend", { p_handle: o.handle });
    expect(await refusal(a.db, "request_friend", { p_handle: others[20].handle })).toContain("too_many_requests");
  }, 60_000);

  it("caps friends at 200", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const fakes: string[] = [];
    for (let i = 0; i < 200; i += 20) {
      const batch = await Promise.all(Array.from({ length: 20 }, async (_, j) => {
        const r = await admin().auth.admin.createUser({ email: `cap-${a.id}-${i + j}@example.test`, email_confirm: true });
        if (r.error) throw r.error;
        return r.data.user.id;
      }));
      fakes.push(...batch);
    }
    const rows = fakes.map((f) => ({ a: f < a.id ? f : a.id, b: f < a.id ? a.id : f, status: "accepted", requested_by: a.id }));
    expect((await admin().from("friendships").insert(rows)).error).toBeNull();
    expect(await refusal(a.db, "request_friend", { p_handle: b.handle })).toContain("too_many_friends");
    expect(await refusal(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") })).toContain("too_many_friends");
  }, 60_000);

  it("can't befriend yourself or an unknown handle", async () => {
    const a = await user();
    expect(await rpc(a.db, "request_friend", { p_handle: a.handle })).toBe("no_such_account");
    expect(await rpc(a.db, "request_friend", { p_handle: "nobody_here_x" })).toBe("no_such_account");
  });
});

describe("blocking", () => {
  it("ends the friendship, cancels requests both ways and hides each from the other", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    await rpc(b.db, "request_friend", { p_handle: a.handle });
    expect(await rpc<unknown[]>(a.db, "find_profile", { p_handle: b.handle })).toHaveLength(1);
    await rpc(a.db, "block_account", { p_account: b.id });
    expect(await friends(a)).toEqual([]);
    expect(await friends(b)).toEqual([]);
    expect(await rpc<unknown[]>(a.db, "find_profile", { p_handle: b.handle })).toEqual([]);
    expect(await rpc<unknown[]>(b.db, "find_profile", { p_handle: a.handle })).toEqual([]);
    expect(await rpc(b.db, "request_friend", { p_handle: a.handle })).toBe("no_such_account");
    expect(await rpc(a.db, "request_friend", { p_handle: b.handle })).toBe("no_such_account");
    expect((await b.db.from("profiles").select("id").eq("id", a.id)).data).toEqual([]);
    expect((await b.db.from("blocks").select("*")).data).toEqual([]);
    await rpc(a.db, "unblock_account", { p_account: b.id });
    expect(await rpc<unknown[]>(b.db, "find_profile", { p_handle: a.handle })).toHaveLength(1);
  });

  it("stores a report about an account, unreadable through the API", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const r = await a.db.from("reports").insert({ name: a.handle, email: "a@example.test", body: "Spam requests again", app_version: "1.4.0", platform: "test", reported_id: b.id });
    expect(r.error).toBeNull();
    expect((await a.db.from("reports").select("*")).data ?? []).toEqual([]);
  });
});

describe("friend links", () => {
  it("make the opener a friend, last 14 days and only the creator revokes", async () => {
    const [a, b, c] = await Promise.all([user(), user(), user()]);
    const code = await rpc<string>(a.db, "create_friend_invite");
    expect(code).toMatch(/^[A-Za-z0-9]{10}$/);
    const info = await rpc<{ kind: string; creator: string; expires_at: string }[]>(b.db, "invite_info", { p_code: code });
    expect(info[0]).toMatchObject({ kind: "friend", creator: a.id });
    expect(new Date(info[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(await rpc(b.db, "redeem_invite", { p_code: code })).toEqual({ kind: "friend", account: a.id });
    expect(await friends(a)).toEqual([expect.objectContaining({ id: b.id, status: "accepted" })]);
    expect(await refusal(b.db, "revoke_invite", { p_code: code })).toContain("no_such_invite");
    await rpc(a.db, "revoke_invite", { p_code: code });
    expect(await refusal(c.db, "redeem_invite", { p_code: code })).toContain("invite_invalid");
  });

  it("friends see each other's name through my_friends, never the profile row (SOC-13); strangers see nothing", async () => {
    const [a, b, s] = await Promise.all([user(), user(), user()]);
    await rpc(b.db, "redeem_invite", { p_code: await rpc<string>(a.db, "create_friend_invite") });
    expect(await rpc(b.db, "my_friends")).toEqual([expect.objectContaining({ id: a.id, handle: a.handle })]);
    expect((await b.db.from("profiles").select("handle").eq("id", a.id)).data).toEqual([]);
    expect((await a.db.from("profiles").select("handle").eq("id", a.id)).data).toEqual([{ handle: a.handle }]);
    expect((await s.db.from("profiles").select("handle").eq("id", a.id)).data).toEqual([]);
    expect((await s.db.from("friendships").select("*")).data).toEqual([]);
  });

  it("keeps the pair-check helpers private", async () => {
    const a = await user();
    expect((await a.db.rpc("is_friend", { x: a.id, y: a.id })).error).not.toBeNull();
    expect((await a.db.rpc("befriend", { x: a.id, y: a.id })).error).not.toBeNull();
    expect((await a.db.rpc("transfer_share_as", { p_share: a.id, p_to: a.id, me: a.id })).error).not.toBeNull();
  });
});

describe("instant updates (social_pings)", () => {
  const pingedAt = async (u: User) => (await u.db.from("social_pings").select("at").eq("account_id", u.id).maybeSingle()).data?.at as string | undefined;

  it("touches both people's ping when a request is sent, accepted or removed", async () => {
    const [a, b] = await Promise.all([user(), user()]);
    await rpc(a.db, "request_friend", { p_handle: b.handle });
    const first = await pingedAt(b);
    expect(first).toBeTruthy();
    expect(await pingedAt(a)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    await rpc(b.db, "respond_friend", { p_account: a.id, p_accept: true });
    expect(Date.parse((await pingedAt(b))!)).toBeGreaterThan(Date.parse(first!));
    await rpc(a.db, "remove_friend", { p_account: b.id });
    expect(await pingedAt(a)).toBeTruthy();
  });

  it("lets each account read only its own ping, and nobody write one", async () => {
    const [a, b, c] = await Promise.all([user(), user(), user()]);
    await rpc(a.db, "request_friend", { p_handle: b.handle });
    const { data } = await c.db.from("social_pings").select("account_id");
    expect(data).toEqual([]);
    const { data: own } = await b.db.from("social_pings").select("account_id");
    expect(own).toEqual([{ account_id: b.id }]);
    const { error } = await c.db.from("social_pings").insert({ account_id: c.id });
    expect(error).not.toBeNull();
    expect(await refusal(c.db, "social_ping", { p_accounts: [a.id] })).toBeTruthy();
  });
});
