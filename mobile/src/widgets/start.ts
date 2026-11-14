import Constants, { ExecutionEnvironment } from "expo-constants";
import { AppState } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { todayWidgetProps } from "@core/domain/todayWidget";
import { useData } from "@core/stores/data";

let timeout: ReturnType<typeof setTimeout> | undefined;
let update: typeof import("./today").updateTodayWidgets = () => {};
const push = () => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    const { tasks, lists } = useData.getState();
    update(todayWidgetProps(tasks, lists, todayLocal()));
  }, 1000);
};

/** Writes the widget snapshot after task changes (debounced) and when the app comes to the front (a new day, a sync pull). Returns a cleanup. */
export function startWidgets(): () => void {
  // Expo Go has no widget native module, and loading `./today` there throws: widgets need a development or store build.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return () => {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  update = (require("./today") as typeof import("./today")).updateTodayWidgets;
  push();
  const unsub = useData.subscribe(push);
  const app = AppState.addEventListener("change", (s) => s === "active" && push());
  return () => (unsub(), app.remove(), clearTimeout(timeout));
}
