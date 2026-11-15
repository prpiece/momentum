import { useReducer, useEffect } from "react";
import { AppState } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { useSettings } from "@core/stores/settings";

/**
 * Today as a local date that follows the clock: it changes when the day rolls over with the app open
 * and when the "day ends at" setting changes (the settings store already feeds `setDayEndHour`).
 * ponytail: a 30 s poll, not a timer to the exact boundary; at most half a minute late.
 */
export function useToday(): string {
  useSettings((s) => s.settings.dayEndHour);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let shown = todayLocal();
    const check = () => todayLocal() !== shown && ((shown = todayLocal()), bump());
    const id = setInterval(check, 30_000);
    const app = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => (clearInterval(id), app.remove());
  }, []);
  return todayLocal();
}
