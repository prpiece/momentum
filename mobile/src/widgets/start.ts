import { AppState } from "react-native";
import { todayLocal } from "@core/domain/dates";
import { todayWidgetProps } from "@core/domain/todayWidget";
import { useData } from "@core/stores/data";
import { updateTodayWidgets } from "./today";

let timeout: ReturnType<typeof setTimeout> | undefined;
const push = () => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    const { tasks, lists } = useData.getState();
    updateTodayWidgets(todayWidgetProps(tasks, lists, todayLocal()));
  }, 1000);
};

/** Writes the widget snapshot after task changes (debounced) and when the app comes to the front (a new day, a sync pull). Returns a cleanup. */
export function startWidgets(): () => void {
  push();
  const unsub = useData.subscribe(push);
  const app = AppState.addEventListener("change", (s) => s === "active" && push());
  return () => (unsub(), app.remove(), clearTimeout(timeout));
}
