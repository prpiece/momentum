import { create } from "zustand";
import { select, upsert, write } from "../db/client";
import type { Row } from "../db/rows";
import { COUNTDOWN_REPEATS, type Countdown } from "../domain/countdown";
import { isInstant, isLocalDate } from "../domain/dates";
import { oneOf } from "../domain/settings";
import { uid } from "./data";

export const useCountdowns = create<{ items: Record<string, Countdown> }>(() => ({ items: {} }));
const set = useCountdowns.setState;

export const parseCountdown = (r: Row): Countdown | null =>
  typeof r.id === "string" && typeof r.title === "string" && isLocalDate(r.date)
    ? {
        id: r.id,
        title: r.title,
        date: r.date,
        direction: r.direction === "since" ? "since" : "until",
        repeat: oneOf(COUNTDOWN_REPEATS, r.repeat) ? r.repeat : "none",
        emoji: typeof r.emoji === "string" && r.emoji ? r.emoji : "⏳",
        color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#5b5bd6",
        pinned: r.pinned === 1,
        createdAt: isInstant(r.created_at) ? r.created_at : new Date().toISOString(),
      }
    : null;

const row = (c: Countdown): Row => ({ id: c.id, title: c.title, date: c.date, direction: c.direction, repeat: c.repeat, emoji: c.emoji, color: c.color, pinned: c.pinned ? 1 : 0, created_at: c.createdAt });

export async function hydrateCountdowns() {
  const rows = await select<Row>("SELECT * FROM countdowns");
  replaceCountdowns(rows.map(parseCountdown).filter((c): c is Countdown => !!c));
}
export const replaceCountdowns = (list: Countdown[]) => set({ items: Object.fromEntries(list.map((c) => [c.id, c])) });
export const saveCountdowns = (list: Countdown[]) => write(...list.map((c) => upsert("countdowns", row(c))));

export function saveCountdown(input: Omit<Countdown, "id" | "createdAt"> & { id?: string }) {
  const prev = input.id ? useCountdowns.getState().items[input.id] : undefined;
  const c: Countdown = { ...input, id: prev?.id ?? uid(), createdAt: prev?.createdAt ?? new Date().toISOString() };
  set((s) => ({ items: { ...s.items, [c.id]: c } }));
  void saveCountdowns([c]);
  return c;
}

export function deleteCountdown(id: string) {
  set((s) => {
    const { [id]: _gone, ...items } = s.items;
    return { items };
  });
  void write(["DELETE FROM countdowns WHERE id = $1", [id]]);
}
