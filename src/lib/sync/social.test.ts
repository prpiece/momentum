import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) }, projectUrl: "http://x" }));
vi.mock("./serverVersion", () => ({ markServerBehind: () => undefined }));

import * as api from "./social";

beforeEach(() => rpc.mockReset());

describe("connections", () => {
  it("reads the permission, defaulting an unknown value to add", async () => {
    rpc.mockResolvedValue({ data: [{ id: "1", source: "slack", label: null, digest_time: null, created_at: "", permission: "full" }, { id: "2", source: "discord", permission: "weird" }], error: null });
    expect((await api.myConnections()).map((c) => c.permission)).toEqual(["full", "add"]);
  });
  it("sets chat and webhook permission through the server calls", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await api.setConnectionPermission("1", "full");
    await api.setWebhookPermission("add");
    expect(rpc).toHaveBeenNthCalledWith(1, "set_connection_permission", { p_id: "1", p_permission: "full" });
    expect(rpc).toHaveBeenNthCalledWith(2, "set_webhook_permission", { p_permission: "add" });
  });
  it("link codes are 8 digits", async () => {
    rpc.mockResolvedValue({ data: "12345678", error: null });
    expect(await api.createLinkCode()).toBe("12345678");
    rpc.mockResolvedValue({ data: "123456", error: null });
    await expect(api.createLinkCode()).rejects.toThrow();
  });
});

describe("friends", () => {
  it("a miss from request_friend is an error the user can read", async () => {
    rpc.mockResolvedValue({ data: "no_such_account", error: null });
    await expect(api.requestFriend("nobody")).rejects.toThrow("No one has that handle.");
    rpc.mockResolvedValue({ data: "pending", error: null });
    expect(await api.requestFriend("sam")).toBe("pending");
  });
  it("lists blocked accounts and unblocks", async () => {
    rpc.mockResolvedValue({ data: [{ id: "u", handle: "sam", display_name: null, avatar: null }], error: null });
    expect(await api.myBlocks()).toEqual([{ id: "u", handle: "sam", displayName: null, avatar: null }]);
    await api.unblockAccount("u");
    expect(rpc).toHaveBeenLastCalledWith("unblock_account", { p_account: "u" });
  });
});

describe("invite links", () => {
  it("lists live links", async () => {
    rpc.mockResolvedValue({ data: [{ code: "AbCdEfGhJk", kind: "share", share_id: "s", share_name: "Trip", role: "editor", max_uses: 1, uses: 0, expires_at: "2026-12-01T00:00:00Z" }], error: null });
    expect(await api.myInvites()).toEqual([{ code: "AbCdEfGhJk", kind: "share", shareId: "s", shareName: "Trip", role: "editor", maxUses: 1, uses: 0, expiresAt: "2026-12-01T00:00:00Z" }]);
  });
  it("sends max_uses only when asked", async () => {
    rpc.mockResolvedValue({ data: "AbCdEfGhJk", error: null });
    await api.createShareInvite("s", "viewer");
    expect(rpc).toHaveBeenLastCalledWith("create_share_invite", { p_share: "s", p_role: "viewer" });
    await api.createShareInvite("s", "viewer", null);
    expect(rpc).toHaveBeenLastCalledWith("create_share_invite", { p_share: "s", p_role: "viewer", p_max_uses: null });
  });
});

describe("task comments", () => {
  it("keeps valid rows and drops malformed ones", async () => {
    rpc.mockResolvedValue({
      data: [
        { id: "c1", author_id: "a1", handle: "ann", display_name: null, avatar: null, body: "hi", created_at: "2026-11-18T10:00:00Z", edited_at: null, mine: true },
        { id: "c2", author_id: "a2", body: 5, created_at: "x" },
        { id: "c3", body: "no author", created_at: "x" },
      ],
      error: null,
    });
    const rows = await api.taskComments("t1");
    expect(rpc).toHaveBeenCalledWith("task_comments", { p_task: "t1" });
    expect(rows).toEqual([{ id: "a1", handle: "ann", displayName: null, avatar: null, commentId: "c1", body: "hi", createdAt: "2026-11-18T10:00:00Z", editedAt: null, mine: true }]);
  });
  it("turns a server refusal into a sentence", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "no_such_task", code: "P0002" } });
    await expect(api.addTaskComment("t1", "x")).rejects.toThrow("isn't shared");
  });
});
