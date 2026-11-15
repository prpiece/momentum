/*
 * Friends and everything done with them (v1.4, D260), for both apps. Lives in memory: it is the
 * server's view, refreshed on sign-in, on Realtime events and every few minutes. Nothing here is
 * stored locally except an invite code opened while signed out.
 */
import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { inviteCodeFrom } from "../domain/invite";
import { canEdit } from "../domain/shareAccess";
import * as api from "../lib/sync/social";
import { checkServerVersion, resetServerVersion, serverBehind } from "../lib/sync/serverVersion";
import { setLocalState, state, syncNow, useSync } from "../lib/sync/engine";
import { supabase } from "../lib/sync/supabase";
import { setEditGuard, useData } from "./data";
import { useHabits } from "./habits";

export type Social = {
  loaded: boolean;
  friends: api.Friend[];
  incomingTasks: api.IncomingTask[];
  outgoingTasks: api.OutgoingTask[];
  shares: api.Share[];
  buddyHabits: api.BuddyHabit[];
  myBuddies: api.MyBuddy[];
  /** Friends with a published focus session running: id → end (ISO). */
  focusing: Record<string, string>;
};

const empty: Social = { loaded: false, friends: [], incomingTasks: [], outgoingTasks: [], shares: [], buddyHabits: [], myBuddies: [], focusing: {} };
export const useSocial = create<Social>(() => empty);

/** Requests waiting on you: the badge on Friends. */
export const requestCount = (s: Social) =>
  s.friends.filter((f) => f.status === "pending" && f.incoming).length + s.incomingTasks.length + s.shares.filter((x) => x.status === "invited").length;

/** Each app shows a nudge its own way (desktop: a native notification; phone: expo-notifications). */
let onNudge: (from: api.Profile | null, habitName: string | null) => void = () => undefined;
export const setNudgeHandler = (fn: typeof onNudge) => void (onNudge = fn);

let refreshing: Promise<void> | null = null;
export function refreshSocial(): Promise<void> {
  if (!useSync.getState().account) return Promise.resolve();
  refreshing ??= (async () => {
    const me = useSync.getState().account!;
    // An old server lacks these calls: say so once (Friends, Connections) rather than fail each one (D289).
    await checkServerVersion().catch(() => undefined);
    if (serverBehind()) return void useSocial.setState({ ...empty, loaded: true });
    const [friends, incomingTasks, outgoingTasks, shares, buddyHabits, myBuddies, focus] = await Promise.all([
      api.myFriends(), api.incomingTasks(), api.outgoingTasks(), api.myShares(), api.buddyHabits(), api.myBuddies(), api.friendsFocusing(me),
    ]);
    useSocial.setState({ loaded: true, friends, incomingTasks, outgoingTasks, shares, buddyHabits, myBuddies, focusing: Object.fromEntries(focus.map((f) => [f.id, f.endsAt])) });
  })().catch((e) => console.error("social refresh failed", e)).finally(() => (refreshing = null));
  return refreshing;
}

/** Runs an action, then refreshes (and pulls, when it changed records). */
export async function act<T>(fn: () => Promise<T>, pull = false): Promise<T> {
  const out = await fn();
  await refreshSocial();
  if (pull) void syncNow();
  return out;
}

// ---------- invite links ----------

/**
 * Opens an invite link. Signed out, the code is kept and applied after sign-in (D261).
 * Returns what happened, for the toast.
 */
export async function openInvite(link: string): Promise<"saved" | "friend" | "share" | "invalid"> {
  const code = inviteCodeFrom(link);
  if (!code) return "invalid";
  if (!useSync.getState().account) {
    await setLocalState("pending_invite", code);
    return "saved";
  }
  const r = await act(() => api.redeemInvite(code), true);
  return r.kind;
}

async function applyPendingInvite() {
  const code = await state("pending_invite");
  if (!code) return;
  await setLocalState("pending_invite", "");
  await openInvite(code).catch((e) => console.error("pending invite failed", e));
}

// ---------- live updates ----------

let channel: RealtimeChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function start(me: string) {
  stop();
  void refreshSocial();
  void applyPendingInvite();
  channel = supabase
    .channel(`social:${me}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "nudges", filter: `to_id=eq.${me}` }, (e) => {
      const n = e.new as { from_id?: string; habit_id?: string };
      const s = useSocial.getState();
      const from = s.friends.find((f) => f.id === n.from_id) ?? null;
      onNudge(from, (n.habit_id && useHabits.getState().habits[n.habit_id]?.name) || null);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "sent_tasks" }, () => void refreshSocial())
    // Friend requests and share changes: the server touches this account's own ping row (RLS-private).
    .on("postgres_changes", { event: "*", schema: "public", table: "social_pings", filter: `account_id=eq.${me}` }, () => void refreshSocial())
    .on("postgres_changes", { event: "*", schema: "public", table: "focus_status" }, (e) => {
      const r = e.new as { account_id?: string; ends_at?: string | null };
      if (!r.account_id || r.account_id === me) return;
      const focusing = { ...useSocial.getState().focusing };
      if (r.ends_at && Date.parse(r.ends_at) > Date.now()) focusing[r.account_id] = r.ends_at;
      else delete focusing[r.account_id];
      useSocial.setState({ focusing });
    })
    .subscribe();
  // A safety net for a dropped Realtime connection, or a server without social_pings (schema < 3).
  timer = setInterval(() => void refreshSocial(), 180_000);
}

function stop() {
  if (channel) void supabase.removeChannel(channel);
  if (timer) clearInterval(timer);
  channel = null;
  timer = null;
}

/** Call once at startup (each app's boot): follows sign-in and sign-out. */
export function startSocial() {
  // View-only shares block every edit path at the store (H11); TaskView reads the same rule for its UI.
  setEditGuard((listId) => {
    const { lists, folders } = useData.getState();
    return canEdit(listId, lists, folders, useSocial.getState().shares);
  });
  let current: string | null = null;
  const follow = (account: string | null) => {
    if (account === current) return;
    current = account;
    if (account) start(account);
    else {
      stop();
      resetServerVersion();
      useSocial.setState(empty);
    }
  };
  follow(useSync.getState().account);
  useSync.subscribe((s) => follow(s.account));
}
