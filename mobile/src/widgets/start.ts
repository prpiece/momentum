import Constants, { ExecutionEnvironment } from "expo-constants";
import { AppState } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { todayWidgetProps } from "@core/domain/todayWidget";
import { useData } from "@core/stores/data";
import { useSettings } from "@core/stores/settings";

let timeout: ReturnType<typeof setTimeout> | undefined;
let update: typeof import("./today").updateTodayWidgets = () => {};
const now = () => {
  const { tasks, lists } = useData.getState();
  const at = new Date();
  // iOS widgets can hold a timeline: queue tomorrow's list for the next day boundary so the widget turns over without the app (MOB-12).
  // Android has no timeline; the background task and app launches refresh it.
  const next = new Date(at);
  next.setHours(useSettings.getState().settings.dayEndHour, 0, 0, 0);
  if (next <= at) next.setDate(next.getDate() + 1);
  update(todayWidgetProps(tasks, lists, todayLocal(at)), { date: next, props: todayWidgetProps(tasks, lists, todayLocal(new Date(next.getTime() + 60_000))) });
};
const push = () => {
  clearTimeout(timeout);
  timeout = setTimeout(now, 1000);
};

/** Writes the snapshot immediately: the background task awaits this. */
export function flushWidgets() {
  clearTimeout(timeout);
  try {
    now();
  } catch (e) {
    console.warn("widgets", e); // no widget module in Expo Go
  }
}

/** Writes the widget snapshot after task changes (debounced) and when the app comes to the front (a new day, a sync pull). Returns a cleanup. */
export function startWidgets(): () => void {
  // Expo Go has no widget native module, and loading `./today` there throws: widgets need a development or store build.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return () => {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  update = (require("./today") as typeof import("./today")).updateTodayWidgets;
  push();
  const unsub = useData.subscribe(push);
  // A new "day ends at" hour or a day rolling over with the app open changes what Today holds.
  let hour = useSettings.getState().settings.dayEndHour;
  const unsubSettings = useSettings.subscribe((s) => s.settings.dayEndHour !== hour && ((hour = s.settings.dayEndHour), push()));
  let day = todayLocal();
  const roll = setInterval(() => todayLocal() !== day && ((day = todayLocal()), push()), 30_000);
  const app = AppState.addEventListener("change", (s) => s === "active" && push());
  return () => (unsub(), unsubSettings(), clearInterval(roll), app.remove(), clearTimeout(timeout));
}
