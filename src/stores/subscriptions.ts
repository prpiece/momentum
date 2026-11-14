/*
 * Calendar subscriptions (v1.3): the list, plus refreshing their events. Only the desktop main
 * window fetches (the phone gets the events through sync). When each one was last refreshed and
 * the last error live in memory only: persisting them would sync a write every 30 minutes.
 */
import { create } from "zustand";
import * as repo from "../db/repo";
import { diffSubscription, feedHost, normalizeFeedUrl, subscriptionEvents, type CalendarSubscription } from "../domain/subscriptions";
import { ACCENT_PRESETS } from "../domain/color";
import { commitEvents, deleteEvents, uid, useData } from "./data";

export type RefreshStatus = { busy: boolean; at: string | null; error: string | null };
type State = { subs: Record<string, CalendarSubscription>; status: Record<string, RefreshStatus> };

export const useSubscriptions = create<State>(() => ({ subs: {}, status: {} }));
const get = useSubscriptions.getState;
const set = useSubscriptions.setState;

export const REFRESH_EVERY_MS = 30 * 60_000;

export async function hydrateSubscriptions(purge = true) {
  const subs = (await repo.loadSubscriptions(purge)).filter((s) => !s.deletedAt);
  set({ subs: Object.fromEntries(subs.map((s) => [s.id, s])) });
}

/** The desktop plugs in its Rust `fetch_ics` (src/main.tsx); shared code can't import Tauri. The phone never fetches. */
let fetchIcs: (url: string) => Promise<string> = () => Promise.reject(new Error("Subscriptions refresh on the desktop app."));
export const setFeedFetcher = (fn: typeof fetchIcs) => void (fetchIcs = fn);
const message = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Couldn't refresh the calendar.");

/** Bring one subscription's events in step with its feed. Writes only what changed. Throws on a bad feed (events are left alone). */
async function apply(sub: CalendarSubscription) {
  const text = await fetchIcs(sub.url);
  const { events } = subscriptionEvents(sub, text, new Date().toISOString(), ACCENT_PRESETS[1].hex);
  const existing = Object.values(useData.getState().events).filter((e) => e.subscriptionId === sub.id);
  const { upsert, remove } = diffSubscription(existing, events);
  // Series before their moved instances, so foreign keys hold.
  commitEvents([...upsert].sort((a, b) => Number(!!a.recurrenceParentId) - Number(!!b.recurrenceParentId)));
  commitEvents(remove);
  return upsert.length + remove.length;
}

const patchStatus = (id: string, p: Partial<RefreshStatus>) =>
  set((s) => ({ status: { ...s.status, [id]: { ...(s.status[id] ?? { busy: false, at: null, error: null }), ...p } } }));

export async function refreshSubscription(id: string) {
  const sub = get().subs[id];
  if (!sub || get().status[id]?.busy) return;
  patchStatus(id, { busy: true });
  try {
    await apply(sub);
    patchStatus(id, { busy: false, at: new Date().toISOString(), error: null });
  } catch (e) {
    patchStatus(id, { busy: false, error: message(e) });
  }
}

export const refreshAll = () => Promise.all(Object.keys(get().subs).map(refreshSubscription));

/** Refresh now and every 30 minutes. Main window only. Returns a stop function. */
export function startSubscriptionRefresh() {
  void refreshAll();
  const timer = setInterval(() => void refreshAll(), REFRESH_EVERY_MS);
  return () => clearInterval(timer);
}

/** Add by address. Fetches first, so a bad address is reported and nothing is saved. Returns an error message, or null. */
export async function addSubscription(input: string, name: string, color: string): Promise<string | null> {
  const check = normalizeFeedUrl(input);
  if (!check.ok) return check.error;
  const subs = Object.values(get().subs);
  if (subs.some((s) => s.url === check.url)) return "That calendar is already added.";
  const sub: CalendarSubscription = {
    id: uid(),
    name: name.trim() || feedHost(check.url),
    url: check.url,
    color,
    sortOrder: Math.max(0, ...subs.map((s) => s.sortOrder)) + 1,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  try {
    await apply(sub);
  } catch (e) {
    return message(e);
  }
  set((s) => ({ subs: { ...s.subs, [sub.id]: sub } }));
  patchStatus(sub.id, { at: new Date().toISOString() });
  void repo.saveSubscription(sub);
  return null;
}

/** Rename or recolour. A new colour is applied to its events straight away. */
export async function updateSubscription(id: string, patch: Partial<Pick<CalendarSubscription, "name" | "color">>) {
  const sub = get().subs[id];
  if (!sub) return;
  const next = { ...sub, ...patch, name: (patch.name ?? sub.name).trim().slice(0, 80) || sub.name };
  set((s) => ({ subs: { ...s.subs, [id]: next } }));
  await repo.saveSubscription(next);
  if (patch.color && patch.color !== sub.color) await refreshSubscription(id);
}

/** Remove it and every event it brought. */
export function removeSubscription(id: string) {
  const sub = get().subs[id];
  if (!sub) return;
  deleteEvents(Object.values(useData.getState().events).filter((e) => e.subscriptionId === id && !e.deletedAt).map((e) => e.id));
  set((s) => ({ subs: Object.fromEntries(Object.entries(s.subs).filter(([k]) => k !== id)) }));
  void repo.saveSubscription({ ...sub, deletedAt: new Date().toISOString() });
}
