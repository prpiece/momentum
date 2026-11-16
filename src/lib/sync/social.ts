/*
 * The server calls behind friends, shares, sent tasks, Focus together, check-in buddies and
 * Connections (v1.4). Shared by desktop and the phone. Every reply is checked here (the boundary);
 * the stores and screens trust these types.
 */
import { isLocalDate } from "../../domain/dates";
import { isInviteCode } from "../../domain/invite";
import { failureText, isMissingFunction, SERVER_UPDATE_MESSAGE } from "../../domain/serverStatus";
import type { Role } from "../../domain/shareAccess";

export type { Role };
import { markServerBehind } from "./serverVersion";
import { projectUrl, supabase } from "./supabase";

export type Profile = { id: string; handle: string; displayName: string | null; avatar: string | null };
export type Friend = Profile & { status: "pending" | "accepted"; incoming: boolean; since: string };
export type ShareKind = "folder" | "list";
export type Share = { shareId: string; ownerId: string; kind: ShareKind; containerId: string; name: string | null; role: Role; status: "invited" | "active"; members: number };
export type Member = Profile & { role: Role; status: "invited" | "active"; joinedAt: string };
export type SentPayload = { title: string; description?: string; checklist?: string; subtasks?: { title: string }[]; priority?: number; due_date?: string | null };
export type IncomingTask = { id: string; sender: Profile; payload: SentPayload; createdAt: string };
export type OutgoingTask = { id: string; recipientId: string; handle: string | null; title: string; status: "pending" | "accepted" | "declined"; createdAt: string };
export type BuddyHabit = { owner: Profile; habitId: string; name: string; today: number; canNudge: boolean };
export type MyBuddy = { habitId: string; buddyId: string; handle: string | null; nudges: boolean };
export type Permission = "add" | "full";
export type Connection = { id: string; source: "discord" | "slack" | "telegram"; label: string | null; digestTime: string | null; createdAt: string; permission: Permission };
export type MyInvite = { code: string; kind: "friend" | "share"; shareId: string | null; shareName: string | null; role: "editor" | "viewer" | null; maxUses: number | null; uses: number; expiresAt: string };
export type InviteInfo = { kind: "friend" | "share"; creator: Profile; shareName: string | null; role: "editor" | "viewer" | null; expiresAt: string };

// ---------- boundary checks ----------

type Raw = Record<string, unknown>;
const rec = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(rec) : []);
const oneOf = <T extends string>(v: unknown, all: readonly T[]): v is T => typeof v === "string" && (all as readonly string[]).includes(v);

const profile = (r: Raw, id = "id"): Profile | null => {
  const pid = str(r[id]);
  return pid ? { id: pid, handle: str(r.handle) ?? "", displayName: str(r.display_name), avatar: str(r.avatar) } : null;
};
const all = <T>(v: unknown, f: (r: Raw) => T | null): T[] => rows(v).map(f).filter((x): x is T => x !== null);

function payload(v: unknown): SentPayload | null {
  if (!rec(v) || typeof v.title !== "string") return null;
  return {
    title: v.title,
    ...(typeof v.description === "string" ? { description: v.description } : {}),
    ...(typeof v.checklist === "string" ? { checklist: v.checklist } : {}),
    ...(Array.isArray(v.subtasks) ? { subtasks: v.subtasks.filter(rec).filter((s) => typeof s.title === "string").map((s) => ({ title: s.title as string })) } : {}),
    ...(typeof v.priority === "number" ? { priority: v.priority } : {}),
    ...(isLocalDate(v.due_date) ? { due_date: v.due_date } : {}),
  };
}

/** Server error codes (raised by the functions) as sentences for a toast. */
const MESSAGES: Record<string, string> = {
  no_such_account: "No one has that handle.",
  declined_recently: "They declined recently. You can ask again in a week.",
  too_many_requests: "That's 20 requests today. Try again tomorrow.",
  too_many_friends: "Friend lists hold up to 200 people.",
  invite_invalid: "This invite has expired or was revoked.",
  too_many_members: "This share is full.",
  owner_only: "Only the owner can do that.",
  transfer_first: "Hand the share to someone else before leaving.",
  not_friends: "You can only do that with friends.",
  already_nudged: "You've nudged them today already.",
  nudges_off: "They've turned nudges off for this habit.",
  too_many_invites: "That's a lot of links today. Try again tomorrow.",
  too_many_sent: "You've sent a lot of tasks today. Try again tomorrow.",
  too_many_reports: "That's a lot of reports. Try again later.",
  bad_value: "That change has a value the app can't use.",
};
/** What each server call does, for "Couldn't …" toasts (D289). */
const WHAT: Record<string, string> = {
  my_friends: "load your friends", request_friend: "send the friend request", respond_friend: "answer the friend request", remove_friend: "remove the friend",
  block_account: "block that account", find_profile: "look up that handle", create_friend_invite: "make an invite link", create_share_invite: "make a share link",
  revoke_invite: "revoke the invite", invite_info: "read that invite", redeem_invite: "open that invite", my_shares: "load your shares", share_people: "load the people in this share",
  create_share: "start sharing", invite_to_share: "invite them to the share", set_member_role: "change their role", respond_share: "answer the share invitation",
  remove_member: "remove them from the share", delete_share: "stop sharing", transfer_share: "hand over the share", audience: "check who would see this",
  incoming_tasks: "load tasks sent to you", outgoing_tasks: "load tasks you sent", respond_sent_task: "answer the sent task", set_focus: "share your focus session",
  buddy_habits: "load your buddies' habits", my_buddies: "load your check-in buddies", set_buddies: "save your check-in buddies", nudge: "send the nudge",
  create_link_code: "make a link code", my_connections: "load your connections", remove_connection: "remove the connection", set_digest: "save the digest time",
  has_webhook: "check your webhook", my_invites: "load your invite links", my_blocks: "load the people you blocked", unblock_account: "unblock them",
  set_connection_permission: "change what that chat can do", webhook_permission: "check your webhook", set_webhook_permission: "change what the webhook can do", buddy_decline: "leave as a check-in buddy", create_webhook: "make a webhook", delete_webhook: "delete the webhook",
};
export class SocialError extends Error {}
/** `what` says what failed; a function the server lacks means the server is behind the app. */
function fail(message: string, what = "finish that", error?: { code?: string } | null): never {
  if (isMissingFunction(error ?? null)) {
    markServerBehind();
    throw new SocialError(`${SERVER_UPDATE_MESSAGE}.`);
  }
  const code = Object.keys(MESSAGES).find((k) => message.includes(k));
  throw new SocialError(code ? MESSAGES[code] : failureText(what, { message }));
}

async function call(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error.message, WHAT[fn] ?? fn.replace(/_/g, " "), error);
  return data;
}

// ---------- friends ----------

export const myFriends = async (): Promise<Friend[]> =>
  all(await call("my_friends"), (r) => {
    const p = profile(r);
    return p && oneOf(r.status, ["pending", "accepted"] as const) ? { ...p, status: r.status, incoming: r.incoming === true, since: str(r.since) ?? "" } : null;
  });
/** A miss ("no_such_account") comes back as a value, not an error, so the server can count it (SOC-12). */
export async function requestFriend(handle: string): Promise<"pending" | "accepted" | "friends"> {
  const r = str(await call("request_friend", { p_handle: handle }));
  return r === "pending" || r === "accepted" || r === "friends" ? r : fail("no_such_account");
}
export const respondFriend = (id: string, accept: boolean) => call("respond_friend", { p_account: id, p_accept: accept }).then(() => undefined);
export const removeFriend = (id: string) => call("remove_friend", { p_account: id }).then(() => undefined);
export const unblockAccount = (id: string) => call("unblock_account", { p_account: id }).then(() => undefined);
export const myBlocks = async (): Promise<Profile[]> => all(await call("my_blocks"), (r) => profile(r));
export const blockAccount = (id: string) => call("block_account", { p_account: id }).then(() => undefined);
export const findProfile = async (handle: string): Promise<Profile | null> => all(await call("find_profile", { p_handle: handle }), (r) => profile(r))[0] ?? null;
export async function reportAccount(id: string, body: string, appVersion: string, platform: string) {
  const { error } = await supabase.from("reports").insert({ name: "Account report", email: "in-app@momentum.invalid", body, app_version: appVersion, platform, reported_id: id });
  if (error) fail(error.message, "send the report", error);
}

// ---------- invite links ----------

/** `maxUses` omitted: the server's default (friend links: unlimited). */
export async function createFriendInvite(maxUses?: number | null): Promise<string> {
  const c = await call("create_friend_invite", maxUses === undefined ? {} : { p_max_uses: maxUses });
  return isInviteCode(c) ? c : fail("bad reply");
}
/** `maxUses` omitted: the server's default (share links: one use); null is unlimited. */
export async function createShareInvite(shareId: string, role: "editor" | "viewer", maxUses?: number | null): Promise<string> {
  const c = await call("create_share_invite", { p_share: shareId, p_role: role, ...(maxUses === undefined ? {} : { p_max_uses: maxUses }) });
  return isInviteCode(c) ? c : fail("bad reply");
}
export const myInvites = async (): Promise<MyInvite[]> =>
  all(await call("my_invites"), (r) =>
    typeof r.code === "string" && oneOf(r.kind, ["friend", "share"] as const)
      ? { code: r.code, kind: r.kind, shareId: str(r.share_id), shareName: str(r.share_name), role: oneOf(r.role, ["editor", "viewer"] as const) ? r.role : null,
          maxUses: typeof r.max_uses === "number" ? r.max_uses : null, uses: Number(r.uses) || 0, expiresAt: str(r.expires_at) ?? "" }
      : null);
export const revokeInvite = (code: string) => call("revoke_invite", { p_code: code }).then(() => undefined);
export const inviteInfo = async (code: string): Promise<InviteInfo | null> =>
  all(await call("invite_info", { p_code: code }), (r) => {
    const creator = profile(r, "creator");
    return creator && oneOf(r.kind, ["friend", "share"] as const)
      ? { kind: r.kind, creator, shareName: str(r.share_name), role: oneOf(r.role, ["editor", "viewer"] as const) ? r.role : null, expiresAt: str(r.expires_at) ?? "" }
      : null;
  })[0] ?? null;
export async function redeemInvite(code: string): Promise<{ kind: "friend"; account: string } | { kind: "share"; shareId: string }> {
  const r = await call("redeem_invite", { p_code: code });
  if (rec(r) && r.kind === "friend" && typeof r.account === "string") return { kind: "friend", account: r.account };
  if (rec(r) && r.kind === "share" && typeof r.share_id === "string") return { kind: "share", shareId: r.share_id };
  return fail("bad reply");
}

// ---------- shares ----------

export const myShares = async (): Promise<Share[]> =>
  all(await call("my_shares"), (r) =>
    typeof r.share_id === "string" && typeof r.owner_id === "string" && typeof r.container_id === "string"
      && oneOf(r.kind, ["folder", "list"] as const) && oneOf(r.role, ["owner", "editor", "viewer"] as const) && oneOf(r.status, ["invited", "active"] as const)
      ? { shareId: r.share_id, ownerId: r.owner_id, kind: r.kind, containerId: r.container_id, name: str(r.name), role: r.role, status: r.status, members: Number(r.members) || 0 }
      : null);
export const shareMembers = async (shareId: string): Promise<Member[]> =>
  all(await call("share_people", { p_share: shareId }), (r) => {
    const p = profile(r, "account_id");
    return p && oneOf(r.role, ["owner", "editor", "viewer"] as const) && oneOf(r.status, ["invited", "active"] as const)
      ? { ...p, role: r.role, status: r.status, joinedAt: str(r.joined_at) ?? "" } : null;
  });
export const createShare = async (kind: ShareKind, containerId: string) => str(await call("create_share", { p_kind: kind, p_container: containerId })) ?? fail("bad reply");
export const inviteToShare = (shareId: string, friendId: string, role: "editor" | "viewer") => call("invite_to_share", { p_share: shareId, p_friend: friendId, p_role: role }).then(() => undefined);
export const setMemberRole = (shareId: string, id: string, role: "editor" | "viewer") => call("set_member_role", { p_share: shareId, p_account: id, p_role: role }).then(() => undefined);
export const respondShare = (shareId: string, accept: boolean) => call("respond_share", { p_share: shareId, p_accept: accept }).then(() => undefined);
export const removeMember = (shareId: string, id: string) => call("remove_member", { p_share: shareId, p_account: id }).then(() => undefined);
export const deleteShare = (shareId: string) => call("delete_share", { p_share: shareId }).then(() => undefined);
export const transferShare = (shareId: string, to: string) => call("transfer_share", { p_share: shareId, p_to: to }).then(() => undefined);
/** Who would gain access if something moved into this list or folder (the move confirmation, D135). */
export const audience = async (kind: ShareKind, id: string): Promise<Profile[]> => all(await call("audience", { p_kind: kind, p_id: id }), (r) => profile(r, "account_id"));

// ---------- sent tasks ----------

/** Sends through the inbound function (ADR 0008), which checks the friendship. */
export async function sendTask(to: string, task: SentPayload): Promise<void> {
  const { error } = await supabase.functions.invoke("inbound/send", { body: { to, task } });
  if (error) fail(String((await (error as { context?: Response }).context?.json?.().catch(() => null))?.error ?? error.message), "send the task");
}
export const incomingTasks = async (): Promise<IncomingTask[]> =>
  all(await call("incoming_tasks"), (r) => {
    const sender = profile(r, "sender");
    const p = payload(r.payload);
    return sender && p && typeof r.id === "string" ? { id: r.id, sender, payload: p, createdAt: str(r.created_at) ?? "" } : null;
  });
export const outgoingTasks = async (): Promise<OutgoingTask[]> =>
  all(await call("outgoing_tasks"), (r) =>
    typeof r.id === "string" && typeof r.recipient === "string" && oneOf(r.status, ["pending", "accepted", "declined"] as const)
      ? { id: r.id, recipientId: r.recipient, handle: str(r.handle), title: str(r.title) ?? "", status: r.status, createdAt: str(r.created_at) ?? "" } : null);
/** Accepting returns the new Inbox task's id (it arrives with the next pull). */
export const respondSentTask = async (id: string, accept: boolean) => str(await call("respond_sent_task", { p_id: id, p_accept: accept }));

// ---------- who can send you requests ----------

export async function allowRequests(me: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("allow_requests").eq("id", me).maybeSingle();
  return data?.allow_requests !== "none";
}
export async function setAllowRequests(on: boolean, me: string) {
  const { error } = await supabase.from("profiles").update({ allow_requests: on ? "everyone" : "none" }).eq("id", me);
  if (error) fail(error.message, "change who can send you requests", error);
}

// ---------- Focus together ----------

export async function setShareFocus(on: boolean, me: string) {
  const { error } = await supabase.from("profiles").update({ share_focus: on }).eq("id", me);
  if (error) fail(error.message, "change Focus sharing");
}
/** Publishes a running session's end (or null when it stops); a no-op unless sharing is on. */
export const setFocus = (endsAt: string | null) => call("set_focus", { p_ends_at: endsAt }).then(() => undefined);
export async function friendsFocusing(me: string): Promise<{ id: string; endsAt: string }[]> {
  const { data, error } = await supabase.from("focus_status").select("account_id, ends_at").neq("account_id", me).gt("ends_at", new Date().toISOString());
  if (error) fail(error.message, "check who is focusing");
  return all(data, (r) => (typeof r.account_id === "string" && typeof r.ends_at === "string" ? { id: r.account_id, endsAt: r.ends_at } : null));
}

// ---------- check-in buddies ----------

export const buddyHabits = async (): Promise<BuddyHabit[]> =>
  all(await call("buddy_habits"), (r) => {
    const owner = profile(r, "owner_id");
    return owner && typeof r.habit_id === "string"
      ? { owner, habitId: r.habit_id, name: str(r.name) ?? "", today: Number(r.today) || 0, canNudge: r.can_nudge === true } : null;
  });
export const myBuddies = async (): Promise<MyBuddy[]> =>
  all(await call("my_buddies"), (r) =>
    typeof r.habit_id === "string" && typeof r.buddy_id === "string" ? { habitId: r.habit_id, buddyId: r.buddy_id, handle: str(r.handle), nudges: r.nudges !== false } : null);
export const setBuddies = (habitId: string, buddies: string[], nudges: boolean) => call("set_buddies", { p_habit: habitId, p_buddies: buddies, p_nudges: nudges }).then(() => undefined);
export const buddyDecline = (owner: string, habitId: string) => call("buddy_decline", { p_owner: owner, p_habit: habitId }).then(() => undefined);
export const nudge = (owner: string, habitId: string) => call("nudge", { p_owner: owner, p_habit: habitId }).then(() => undefined);

// ---------- Connections ----------

export async function createLinkCode(): Promise<string> {
  const c = await call("create_link_code");
  return typeof c === "string" && /^\d{8}$/.test(c) ? c : fail("bad reply");
}
export const myConnections = async (): Promise<Connection[]> =>
  all(await call("my_connections"), (r) =>
    typeof r.id === "string" && oneOf(r.source, ["discord", "slack", "telegram"] as const)
      ? { id: r.id, source: r.source, label: str(r.label), digestTime: str(r.digest_time)?.slice(0, 5) ?? null, createdAt: str(r.created_at) ?? "", permission: r.permission === "full" ? "full" : "add" } : null);
export const removeConnection = (id: string) => call("remove_connection", { p_id: id }).then(() => undefined);
export const setDigest = (id: string, time: string | null) => call("set_digest", { p_id: id, p_time: time }).then(() => undefined);
export const setConnectionPermission = (id: string, permission: Permission) => call("set_connection_permission", { p_id: id, p_permission: permission }).then(() => undefined);
export const webhookPermission = async (): Promise<Permission | null> => {
  const p = await call("webhook_permission");
  return p === "full" ? "full" : p === "add" ? "add" : null;
};
export const setWebhookPermission = (permission: Permission) => call("set_webhook_permission", { p_permission: permission }).then(() => undefined);
export const hasWebhook = async () => (await call("has_webhook")) === true;
export async function createWebhook(): Promise<string> {
  const s = await call("create_webhook");
  return typeof s === "string" && /^[0-9a-f]{48}$/.test(s) ? s : fail("bad reply");
}
export const deleteWebhook = () => call("delete_webhook").then(() => undefined);
/** The webhook's URL (the secret is the last path segment). */
export const webhookUrl = (secret: string) => `${projectUrl}/functions/v1/inbound/webhook/${secret}`;
