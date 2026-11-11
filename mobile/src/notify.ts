import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { AppState } from "react-native";
import { remainingMs } from "@core/domain/focus";
import { upcomingFires, type ReminderTarget } from "@core/domain/reminders";
import { derive } from "@core/domain/taskViews";
import { useData } from "@core/stores/data";
import { useFocus } from "@core/stores/focus";
import { useHabits, valuesOf } from "@core/stores/habits";
import { useSettings } from "@core/stores/settings";
import { toggleDone } from "@core/stores/taskActions";

/*
 * Reminders as OS-scheduled local notifications (PLAN D230): the next week's fires are handed to
 * the OS, so they arrive with the app closed. No push, no background fetch: the schedule is
 * rebuilt on start, on resume and after any change to the data (which covers sync pulls).
 */

const DAYS = 7;
/** iOS keeps at most 64 pending notifications; leave room for the focus timer and snoozes. */
const LIMIT = 60;
const SNOOZE_MIN = 10;
const CHANNEL = "reminders";
const FOCUS_ID = "focus";
const SNOOZED = ":snooze";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** `data` comes back from the OS: check its shape before trusting it. */
function targetOf(data: unknown): ReminderTarget | null {
  const t = typeof data === "object" && data !== null && "target" in data ? data.target : null;
  if (typeof t !== "object" || t === null || !("kind" in t)) return null;
  if (t.kind === "digest") return { kind: "digest" };
  if (!("id" in t) || typeof t.id !== "string") return null;
  const occurrenceKey = "occurrenceKey" in t && typeof t.occurrenceKey === "string" ? t.occurrenceKey : null;
  if (t.kind === "task" || t.kind === "event") return { kind: t.kind, id: t.id, occurrenceKey };
  if (t.kind === "habit") return { kind: "habit", id: t.id };
  return null;
}

function open(t: ReminderTarget) {
  if (t.kind === "task") router.push({ pathname: "/task/[id]", params: { id: t.id, key: t.occurrenceKey ?? "" } });
  else if (t.kind === "event") router.push({ pathname: "/event/[id]", params: { id: t.id, key: t.occurrenceKey ?? "" } });
  else if (t.kind === "habit") router.push({ pathname: "/habit/[id]", params: { id: t.id } });
  else router.navigate("/");
}

async function respond(r: Notifications.NotificationResponse) {
  const req = r.notification.request;
  const target = targetOf(req.content.data);
  void Notifications.dismissNotificationAsync(req.identifier);
  if (r.actionIdentifier === "done" && target?.kind === "task") return void toggleDone(target.id, target.occurrenceKey);
  if (r.actionIdentifier === "snooze") {
    const id = req.identifier.endsWith(SNOOZED) ? req.identifier : req.identifier + SNOOZED;
    return void Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title: req.content.title, body: req.content.body, data: req.content.data, categoryIdentifier: req.content.categoryIdentifier ?? undefined },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: SNOOZE_MIN * 60, channelId: CHANNEL },
    });
  }
  if (target) open(target);
}

/** Asks once, the first time there's something to remind about. */
async function allowed() {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || !p.canAskAgain) return p.granted;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function apply() {
  const now = Date.now();
  const { tasks, lists, events } = useData.getState();
  const { habits, checkins } = useHabits.getState();
  const settings = useSettings.getState().settings;
  const fires = upcomingFires(
    { active: derive(tasks, lists).active, events: Object.values(events), habits: Object.values(habits), habitValues: (id) => valuesOf(checkins[id]), settings },
    new Date(now),
    new Date(now + DAYS * 86_400_000),
  ).slice(0, LIMIT);
  const timer = useFocus.getState().timer;
  const focusLeft = timer.status === "running" ? remainingMs(timer, now, settings.pomodoro) : null;

  for (const n of await Notifications.getAllScheduledNotificationsAsync()) if (!n.identifier.endsWith(SNOOZED)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  if ((!fires.length && focusLeft === null) || !(await allowed())) return;

  const at = (date: Date) => ({ type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL }) as const;
  for (const f of fires)
    await Notifications.scheduleNotificationAsync({
      identifier: f.key,
      content: { title: f.title, body: f.body, data: { target: f.target }, categoryIdentifier: f.target.kind === "task" ? "task" : "reminder" },
      trigger: at(f.at),
    });
  if (focusLeft !== null && timer.status === "running")
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_ID,
      content: timer.phase === "focus" ? { title: "Focus session done", body: "Time for a break." } : { title: "Break's over", body: "Back to focus." },
      trigger: at(new Date(now + focusLeft)),
    });
}

let chain = Promise.resolve();
let timeout: ReturnType<typeof setTimeout> | undefined;
/** Debounced: a burst of writes (or a sync pull) reschedules once. Runs never overlap. */
const reschedule = () => {
  clearTimeout(timeout);
  timeout = setTimeout(() => (chain = chain.then(apply).catch((e: unknown) => console.warn("reminders", e))), 1000);
};

/** Returns a cleanup, so a remount (or a dev hot reload) doesn't leave a second set of listeners behind. */
export function startReminders(): () => void {
  let stopped = false;
  const subs: { remove: () => void }[] = [];
  void (async () => {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Reminders", importance: Notifications.AndroidImportance.HIGH });
    await Notifications.setNotificationCategoryAsync("task", [
      { identifier: "done", buttonTitle: "Done", options: { opensAppToForeground: false } },
      { identifier: "snooze", buttonTitle: `Snooze ${SNOOZE_MIN} min`, options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync("reminder", [{ identifier: "snooze", buttonTitle: `Snooze ${SNOOZE_MIN} min`, options: { opensAppToForeground: false } }]);
    if (stopped) return;
    // ponytail: a Done/Snooze pressed while the app is killed is handled the next time it starts; a headless task (expo-task-manager) would handle it at once.
    subs.push(Notifications.addNotificationResponseReceivedListener((r) => void respond(r)));
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last && !stopped) {
      void respond(last);
      void Notifications.clearLastNotificationResponseAsync();
    }
  })();
  for (const store of [useData, useHabits, useSettings, useFocus] as const) subs.push({ remove: store.subscribe(reschedule) });
  subs.push(AppState.addEventListener("change", (s) => s === "active" && reschedule()));
  reschedule();
  return () => {
    stopped = true;
    for (const s of subs) s.remove();
  };
}
