import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Alert, AppState, Platform } from "react-native";
import { isAlarm } from "@core/domain/alarms";
import { remainingMs } from "@core/domain/focus";
import { upcomingFires, type ReminderTarget } from "@core/domain/reminders";
import { derive } from "@core/domain/taskViews";
import { useData } from "@core/stores/data";
import { autoStartFocus, startFocus, useFocus } from "@core/stores/focus";
import { useHabits, valuesOf } from "@core/stores/habits";
import { useSettings } from "@core/stores/settings";
import { toggleDone } from "@core/stores/taskActions";
import { alarmsSupported, canUseFullScreenIntent, openFullScreenIntentSettings, setAlarms, type Alarm } from "../modules/momentum-alarm";

/*
 * Reminders as OS-scheduled local notifications (PLAN D230): the next week's fires are handed to
 * the OS, so they arrive with the app closed. No push: the schedule is rebuilt on start, on resume,
 * after any change to the data (which covers sync pulls) and by the periodic background task (src/backgroundTask.ts).
 */

const DAYS = 7;
/** iOS keeps at most 64 pending notifications; leave room for the focus timer (1) and snoozes. */
const LIMIT = 56;
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
  // "Focus starts now": tapping begins the session on that task (if one isn't already running).
  const focusTask = typeof req.content.data?.focusTask === "string" ? req.content.data.focusTask : null;
  if (focusTask) {
    if (useFocus.getState().timer.status === "idle" || useFocus.getState().timer.status === "done") startFocus("stopwatch", focusTask);
    return router.push("/focus");
  }
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

const ASKED = "alarmPermissionAsked";

/**
 * Call when a high-priority task gets a reminder. Android 14+ makes the user grant full-screen
 * intents in settings, so explain once and open the page; if they say no, alarms stay normal heads-up notifications.
 */
export async function askAlarmPermission() {
  if (!alarmsSupported || canUseFullScreenIntent()) return;
  if ((await SecureStore.getItemAsync(ASKED).catch(() => null)) === "1") return;
  await SecureStore.setItemAsync(ASKED, "1").catch(() => undefined);
  Alert.alert("Let alarms take over the screen?", "High-priority reminders can ring like an alarm clock, even on the lock screen. Android needs you to allow this in settings. Without it they show as normal notifications.", [
    { text: "Not now", style: "cancel" },
    { text: "Open settings", onPress: openFullScreenIntentSettings },
  ]);
}

/** Ask in context: call from the action that sets a reminder or starts a timer, never at launch (MOB-08). */
export async function askNotificationPermission() {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || !p.canAskAgain) return p.granted;
  return (await Notifications.requestPermissionsAsync()).granted;
}
const allowed = async () => (await Notifications.getPermissionsAsync()).granted;

/** Cancels every pending notification that isn't in `keep` (snoozes stay). Scheduling first means a kill mid-run never leaves none. */
async function prune(keep: Set<string>) {
  for (const n of await Notifications.getAllScheduledNotificationsAsync()) if (!n.identifier.endsWith(SNOOZED) && !keep.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
}

async function apply() {
  const now = Date.now();
  const { tasks, lists, events } = useData.getState();
  const { habits, checkins } = useHabits.getState();
  const settings = useSettings.getState().settings;
  const active = derive(tasks, lists).active;
  // Time blocks that auto-start focus: their own notification replaces the plain "starting now" one.
  const focusNotices = settings.notify.enabled && settings.notify.focus;
  const blocks = settings.autoFocus && focusNotices
    ? active.flatMap(({ task, schedule }) => (schedule.kind === "timed" && Date.parse(schedule.start) > now && Date.parse(schedule.start) <= now + DAYS * 86_400_000 ? [{ task, start: new Date(schedule.start) }] : []))
        .sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, 10)
    : [];
  const blockIds = new Set(blocks.map((b) => b.task.id));
  const fires = upcomingFires(
    { active, events: Object.values(events), habits: Object.values(habits), habitValues: (id) => valuesOf(checkins[id]), settings },
    new Date(now),
    new Date(now + DAYS * 86_400_000),
  )
    .filter((f) => !(f.key.startsWith("start:") && f.target.kind === "task" && blockIds.has(f.target.id)))
    .slice(0, LIMIT - blocks.length);
  const timer = useFocus.getState().timer;
  const focusLeft = focusNotices && timer.status === "running" ? remainingMs(timer, now, settings.pomodoro) : null;

  const priority = (id: string) => tasks[id]?.priority;
  const ringing = (f: (typeof fires)[number]) => isAlarm(f, priority);
  const keep = new Set<string>();
  if ((!fires.length && !blocks.length && focusLeft === null) || !(await allowed())) return void (await prune(keep), setAlarms([]));

  const at = (date: Date) => ({ type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL }) as const;
  // Android rings high-priority reminders as full-screen alarms through the native module; iOS marks them time-sensitive.
  const alarms: Alarm[] = [];
  for (const f of fires) {
    const alarm = ringing(f);
    if (alarm && alarmsSupported && f.target.kind === "task") {
      const url = `momentum://task/${encodeURIComponent(f.target.id)}?key=${encodeURIComponent(f.target.occurrenceKey ?? "")}`;
      alarms.push({ id: f.key, at: f.at.getTime(), title: f.title, body: f.body, url });
      continue;
    }
    keep.add(f.key);
    await Notifications.scheduleNotificationAsync({
      identifier: f.key,
      content: {
        title: f.title,
        body: f.body,
        data: { target: f.target },
        categoryIdentifier: f.target.kind === "task" ? "task" : "reminder",
        ...(alarm && Platform.OS === "ios" ? { interruptionLevel: "timeSensitive" as const } : {}),
      },
      trigger: at(f.at),
    });
  }
  setAlarms(alarms);
  for (const b of blocks) {
    const identifier = `autofocus:${b.task.id}:${b.start.toISOString()}`;
    keep.add(identifier);
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: `Focus starts now: ${b.task.title}`, body: "Tap to start the timer", data: { focusTask: b.task.id } },
      trigger: at(b.start),
    });
  }
  if (focusLeft !== null && timer.status === "running") {
    keep.add(FOCUS_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_ID,
      content: timer.phase === "focus" ? { title: "Focus session done", body: "Time for a break." } : { title: "Break's over", body: "Back to focus." },
      trigger: at(new Date(now + focusLeft)),
    });
  }
  await prune(keep);
}

let chain = Promise.resolve();
/** Reschedules now and resolves when done (the background task awaits it; the debounced `reschedule` is for the foreground). */
export const refreshReminders = () => (chain = chain.then(apply).catch((e: unknown) => console.warn("reminders", e)));
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
  // While the app is open, a time block that just began starts focus itself (the OS can't do it when closed).
  const openTasks = () => derive(useData.getState().tasks, useData.getState().lists).active;
  const tick = () => AppState.currentState === "active" && autoStartFocus(openTasks);
  tick();
  const interval = setInterval(tick, 5000);
  subs.push({ remove: () => clearInterval(interval) }, AppState.addEventListener("change", (s) => s === "active" && tick()));
  reschedule();
  return () => {
    stopped = true;
    for (const s of subs) s.remove();
  };
}
