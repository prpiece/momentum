import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { syncNow } from "@core/lib/sync/engine";
import { ready } from "./boot";
import { refreshReminders } from "./notify";
import { flushWidgets } from "./widgets/start";

/*
 * Periodic background refresh (MOB-10, MOB-12): the OS wakes the app about every hour or more (Android
 * WorkManager, iOS BGTaskScheduler; timing is up to the OS), and it pulls sync, rebuilds the scheduled
 * reminders and rewrites the widget. Without it, changes made on the computer reach the phone's
 * notifications and widget only when the app is opened.
 */
const TASK = "momentum-refresh";

TaskManager.defineTask(TASK, async () => {
  try {
    await ready;
    await syncNow();
    await refreshReminders();
    flushWidgets();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn("background refresh", e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Idempotent: call on every start. 60 minutes is the shortest the OS honours reliably. */
export async function registerBackgroundRefresh() {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 });
}
