import { create } from "zustand";
import { select, upsert, write } from "../db/client";
import type { Row } from "../db/rows";
import type { Countdown } from "../domain/countdown";
import { countdownRow, parseCountdown } from "../db/miscRows";
import { uid } from "./data";

export const useCountdowns = create<{ items: Record<string, Countdown> }>(() => ({ items: {} }));
const set = useCountdowns.setState;

export async function hydrateCountdowns() {
  const rows = await select<Row>("SELECT * FROM countdowns");
  replaceCountdowns(rows.map(parseCountdown).filter((c): c is Countdown => !!c));
}
export const replaceCountdowns = (list: Countdown[]) => set({ items: Object.fromEntries(list.map((c) => [c.id, c])) });
export const saveCountdowns = (list: Countdown[]) => write(...list.map((c) => upsert("countdowns", countdownRow(c))));

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
