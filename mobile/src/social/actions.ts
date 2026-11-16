/*
 * What the phone does with friends (v1.4): thin wrappers over the shared client layer that pick a
 * friend or an option in a sheet, run the server call and say what happened in a toast.
 */
import Constants from "expo-constants";
import { Alert, Platform, Share } from "react-native";
import { inviteCodeFrom, inviteUrl } from "@core/domain/invite";
import type { Habit } from "@core/domain/habits";
import type { Task } from "@core/domain/types";
import { useSync } from "@core/lib/sync/engine";
import * as api from "@core/lib/sync/social";
import { act, openInvite, useSocial } from "@core/stores/social";
import { toast } from "@core/stores/toast";
import { askText, choose } from "@/ui/Sheet";

/** Runs a server call; a failure becomes the toast (SocialError messages are written for users). */
export async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast(e instanceof api.SocialError ? e.message : "Something went wrong. Try again.");
    return undefined;
  }
}

/** True when signed in; otherwise says where to sign in. */
export function signedIn(what = "do that"): boolean {
  if (useSync.getState().account) return true;
  toast(`Sign in under Account to ${what}.`);
  return false;
}

export const nameOf = (p: api.Profile) => p.displayName || `@${p.handle}`;
export const acceptedFriends = () => useSocial.getState().friends.filter((f) => f.status === "accepted");

/** Pick one of your friends (optionally leaving some out); null when dismissed or there are none. */
export async function pickFriend(title: string, except: string[] = []): Promise<api.Friend | null> {
  const friends = acceptedFriends().filter((f) => !except.includes(f.id));
  if (!friends.length) {
    toast("No friends to choose from yet. Add one under Friends.");
    return null;
  }
  const id = await choose<string>(title, friends.map((f) => ({ value: f.id, label: nameOf(f), detail: f.displayName ? `@${f.handle}` : undefined, icon: "user" as const })));
  return friends.find((f) => f.id === id) ?? null;
}

const ATTACHMENT = /!\[[^\]]*\]\(attachment:[^)]+\)/g;

/** Send to friend (task actions): title, notes, checklist and subtasks; the copies aren't linked afterwards (D260). */
export async function sendToFriend(task: Task, subtasks: string[]) {
  if (!signedIn("send tasks")) return;
  const to = await pickFriend("Send to");
  if (!to) return;
  const description = task.description.replace(ATTACHMENT, "").trim();
  const sent = await run(() =>
    api
      .sendTask(to.id, {
        title: task.title,
        ...(description ? { description } : {}),
        ...(task.checklist.length ? { checklist: JSON.stringify(task.checklist) } : {}),
        ...(subtasks.length ? { subtasks: subtasks.map((title) => ({ title })) } : {}),
      })
      .then(() => true),
  );
  if (sent) {
    toast(`Sent to ${nameOf(to)}. It waits in their Requests until they accept.`);
    void act(async () => undefined);
  }
}

/**
 * Opens a pasted link or code (or one the OS handed over) and says what came of it. A link from
 * outside the app (`confirm`) shows who it is from and what it grants, and waits for a tap (SOC-01).
 */
export async function openLink(text: string, confirm = false) {
  const code = inviteCodeFrom(text);
  if (confirm && code && useSync.getState().account) {
    const info = await run(() => api.inviteInfo(code));
    const who = info ? `@${info.creator.handle}` : null;
    if (!who) return void toast("That invite has expired or isn't valid.");
    const what = info!.kind === "friend" ? "become friends" : `join "${info!.shareName ?? "a shared list"}" as ${info!.role ?? "a member"}`;
    const ok = await new Promise<boolean>((done) =>
      Alert.alert("Accept invite?", `${who} invited you to ${what}.`, [
        { text: "Cancel", style: "cancel", onPress: () => done(false) },
        { text: "Accept", onPress: () => done(true) },
      ], { onDismiss: () => done(false) }),
    );
    if (!ok) return;
  }
  const r = await run(() => openInvite(text));
  if (!r) return;
  toast(r === "saved" ? "Invite saved. It applies once you sign in." : r === "friend" ? "You're now friends." : r === "share" ? "You joined the share." : "That isn't a Momentum invite link.");
}

export async function addFriend() {
  if (!signedIn("add friends")) return;
  const text = await askText("Add friend", { placeholder: "@handle", confirm: "Send request" });
  if (!text) return;
  const handle = text.trim().replace(/^@/, "").toLowerCase();
  const r = await run(() => act(() => api.requestFriend(handle)));
  if (r) toast(r === "pending" ? `Request sent to @${handle}.` : `You and @${handle} are friends.`);
}

export async function shareFriendLink() {
  if (!signedIn("invite friends")) return;
  const code = await run(() => api.createFriendInvite());
  if (code) await Share.share({ message: `Add me on Momentum: ${inviteUrl(code)}` });
}

/** Blocks a sender from a request (SOC-11), after confirming. */
export function blockPerson(p: api.Profile) {
  Alert.alert(`Block ${nameOf(p)}?`, "You stop seeing each other, and you are removed from each other's shared lists. You can unblock them from Friends.", [
    { text: "Cancel", style: "cancel" },
    { text: "Block", style: "destructive", onPress: () => void run(() => act(() => api.blockAccount(p.id))) },
  ]);
}

export function unblockPerson(p: api.Profile, then: () => void) {
  Alert.alert(`Unblock ${nameOf(p)}?`, "They can find you and send requests again.", [
    { text: "Cancel", style: "cancel" },
    { text: "Unblock", onPress: () => void run(() => api.unblockAccount(p.id).then(() => true)).then(then) },
  ]);
}

/** Your live invite links: pick one to revoke it (SOC-04). */
export async function manageLinks() {
  const links = await run(api.myInvites);
  if (!links) return;
  if (!links.length) return void toast("You have no live invite links.");
  const code = await choose<string>("Invite links", links.map((l) => ({
    value: l.code,
    label: l.kind === "friend" ? "Friend link" : `${l.shareName ?? "Share"} · ${l.role === "viewer" ? "view only" : "can edit"}`,
    icon: "link" as const,
  })));
  if (!code) return;
  Alert.alert("Revoke this link?", "Anyone who hasn't used it yet can't any more.", [
    { text: "Cancel", style: "cancel" },
    { text: "Revoke", style: "destructive", onPress: () => void run(() => api.revokeInvite(code).then(() => true)).then((ok) => ok && toast("Link revoked.")) },
  ]);
}

export async function friendMenu(f: api.Friend) {
  const a = await choose(nameOf(f), [
    { value: "remove", label: "Remove friend", icon: "user-minus" },
    { value: "block", label: "Block", icon: "slash", danger: true },
    { value: "report", label: "Report", icon: "flag", danger: true },
  ]);
  if (a === "remove")
    Alert.alert(`Remove ${nameOf(f)}?`, "You'll stop being friends. Shares aren't touched.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void run(() => act(() => api.removeFriend(f.id))) },
    ]);
  else if (a === "block")
    Alert.alert(`Block ${nameOf(f)}?`, "This ends the friendship and cancels requests both ways. They won't find you in search, and you are removed from each other's shared lists. You can unblock them from Friends.", [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: () => void run(() => act(() => api.blockAccount(f.id))) },
    ]);
  else if (a === "report") {
    const body = await askText(`Report ${nameOf(f)}`, { placeholder: "What happened?", confirm: "Report" });
    if (body && (await run(() => api.reportAccount(f.id, body, Constants.expoConfig?.version ?? "unknown", Platform.OS).then(() => true)))) toast("Thanks. We'll look at it.");
  }
}

/** Habit → check-in buddies and nudges (D260). Toggles one option at a time until Done, like the weekday picker. */
export async function chooseBuddies(h: Habit) {
  if (!signedIn("choose buddies")) return;
  const rows = useSocial.getState().myBuddies.filter((b) => b.habitId === h.id);
  let ids = rows.map((b) => b.buddyId);
  let nudges = rows.every((b) => b.nudges);
  for (;;) {
    const v = await choose<string>("Check-in buddies", [
      ...acceptedFriends().map((f) => ({ value: f.id, label: nameOf(f), icon: "user" as const, selected: ids.includes(f.id) })),
      { value: "nudges", label: "Allow nudges", icon: "bell" as const, selected: nudges },
      { value: "done", label: "Done", icon: "check" as const },
    ]);
    if (v === null) return;
    if (v === "done") break;
    if (v === "nudges") nudges = !nudges;
    else ids = ids.includes(v) ? ids.filter((x) => x !== v) : [...ids, v];
  }
  await run(() => act(() => api.setBuddies(h.id, ids, nudges)));
}
