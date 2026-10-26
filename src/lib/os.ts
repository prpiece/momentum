/*
 * OS integration for the main window: notifications, the reminder popup, the global quick-add
 * shortcut, close-to-tray, launch at login and the focus ticker. The main window is the only
 * writer; the popup windows send it events ("quickadd:create", "reminder:action").
 */
import { isTauri } from "../db/client";
import { focusPhaseLabel } from "../features/focus/FocusView";
import { createFromText } from "../features/tasks/quickAddSubmit";
import { todayLocal } from "../domain/dates";
import { isDone, targetOf } from "../domain/habits";
import { checkinOf, setCheckin, useHabits } from "../stores/habits";
import { setPhaseEndHandler, tickFocus } from "../stores/focus";
import { useSettings } from "../stores/settings";
import { go, openEvent, openTask, toast } from "../stores/ui";
import { snoozeReminder, startReminders, type ReminderDTO } from "./reminderScheduler";
import { setStatus, useData } from "../stores/data";

export type ReminderAction = { dto: ReminderDTO; action: "done" | "open" | "dismiss" } | { dto: ReminderDTO; action: "snooze"; minutes: number };

/** Done / snooze / open, whichever window the click came from. */
export function handleReminderAction(a: ReminderAction) {
  const t = a.dto.target;
  if (a.action === "snooze") return snoozeReminder(a.dto, a.minutes);
  if (a.action === "done") {
    if (t.kind === "task") {
      if (useData.getState().tasks[t.id]?.status === "open") setStatus(t.id, "done", t.occurrenceKey);
    } else if (t.kind === "habit") {
      // "Done" from a habit reminder means today's goal is met.
      const h = useHabits.getState().habits[t.id];
      const today = todayLocal();
      if (h && !isDone(h, checkinOf(h.id, today)?.value)) setCheckin(h.id, today, { value: targetOf(h) });
    }
  }
  if (a.action === "open") {
    void showMain();
    if (t.kind === "task") openTask(t.id, t.occurrenceKey);
    else if (t.kind === "event") {
      go("calendar");
      openEvent(t.id, t.occurrenceKey);
    } else go(t.kind === "habit" ? "habits" : "today");
  }
}

async function showMain() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await w.unminimize();
  await w.show();
  await w.setFocus();
}

/** A short two-note chime (Web Audio, so no sound file ships with the app). */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.14;
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // No audio device: notifications still show.
  }
}

const notifySettings = () => useSettings.getState().settings.notify;

/** Shows a reminder the way Settings → Notifications says. Replaced with the OS version once Tauri is up. */
let deliver = (dto: ReminderDTO) => {
  if (notifySettings().sound) chime();
  toast(`${dto.title} · ${dto.body}`, dto.target.kind === "task" ? { label: "Done", run: () => handleReminderAction({ dto, action: "done" }) } : undefined);
};
/** Simple one-line notices (focus phases, quick add), gated by their own setting. */
let notice = (title: string, body: string) => toast(`${title} · ${body}`);

/** Settings → Notifications → "Send a test". */
export function testNotification() {
  deliver({ key: `test:${Date.now()}`, at: new Date().toISOString(), title: "Momentum notifications work", body: "This is how reminders will look.", target: { kind: "digest" } });
}

export async function initOs() {
  setInterval(tickFocus, 1000);
  setPhaseEndHandler((_, next) => notifySettings().enabled && notifySettings().focus && notice("Momentum focus", focusPhaseLabel(next)));

  if (!isTauri) return startReminders((r) => deliver(r));

  const [{ listen, emit }, { Window }, { PhysicalPosition }, notif, shortcut, autostart, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/dpi"),
    import("@tauri-apps/plugin-notification"),
    import("@tauri-apps/plugin-global-shortcut"),
    import("@tauri-apps/plugin-autostart"),
    import("@tauri-apps/api/core"),
  ]);
  const settings = () => useSettings.getState().settings;

  // --- notifications -------------------------------------------------------
  let canNotify = await notif.isPermissionGranted();
  if (!canNotify) canNotify = (await notif.requestPermission()) === "granted";
  const osNotify = (title: string, body: string) => {
    if (canNotify) notif.sendNotification({ title, body });
  };
  notice = (title, body) => osNotify(title, body);

  // --- reminder popup ------------------------------------------------------
  // Native toasts on Windows have no action buttons through the plugin, so a small always-on-top
  // popup carries Done / Snooze / Open (PLAN R1).
  const showReminderPopup = async (dto: ReminderDTO) => {
    const w = await Window.getByLabel("reminder");
    if (!w) return;
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const m = await currentMonitor();
    const size = await w.outerSize();
    if (m) {
      const margin = Math.round(16 * m.scaleFactor);
      const { x, y } = m.workArea.position;
      const top = notifySettings().corner === "top-right";
      await w.setPosition(new PhysicalPosition(x + m.workArea.size.width - size.width - margin, top ? y + margin : y + m.workArea.size.height - size.height - margin));
    }
    await w.show();
    await emit("reminder:show", dto);
  };
  await listen<ReminderAction>("reminder:action", (e) => handleReminderAction(e.payload));
  deliver = (dto) => {
    const { style, sound } = notifySettings();
    if (style !== "popup") osNotify(dto.title, dto.body);
    if (style !== "system") {
      if (sound) chime();
      void showReminderPopup(dto);
    }
  };
  void startReminders((dto) => deliver(dto));

  // --- global quick add ----------------------------------------------------
  await listen<{ text: string; raw: boolean }>("quickadd:create", (e) => {
    const t = createFromText(e.payload.text, {}, settings().smartParse && !e.payload.raw, () => false);
    if (t && notifySettings().enabled && notifySettings().quickAdd) osNotify("Added to Momentum", t.title);
  });
  let bound: string | null = null;
  const bindShortcut = async (accel: string) => {
    if (bound) await shortcut.unregister(bound).catch(() => undefined);
    bound = null;
    try {
      await shortcut.register(accel, async (e) => {
        if (e.state !== "Pressed") return;
        const w = await Window.getByLabel("quickadd");
        await w?.center();
        await w?.show();
        await w?.setFocus();
        await emit("quickadd:focus");
      });
      bound = accel;
    } catch (err) {
      console.error("Global shortcut registration failed", err);
      toast(`Couldn't register ${accel.replace("CommandOrControl", "Ctrl")}: another app may be using it. Pick another in Settings.`);
    }
  };
  await bindShortcut(settings().quickAddShortcut);

  // --- close to tray & launch at login -------------------------------------
  await invoke("set_close_to_tray", { enabled: settings().closeToTray });
  const syncAutostart = async (want: boolean) => {
    try {
      if ((await autostart.isEnabled()) !== want) await (want ? autostart.enable() : autostart.disable());
    } catch (err) {
      console.error("Autostart change failed", err);
      toast("Couldn't change the launch-at-login setting.");
    }
  };
  await syncAutostart(settings().launchAtStartup);

  useSettings.subscribe((s, prev) => {
    const a = s.settings;
    const b = prev.settings;
    if (a.quickAddShortcut !== b.quickAddShortcut) void bindShortcut(a.quickAddShortcut);
    if (a.closeToTray !== b.closeToTray) void invoke("set_close_to_tray", { enabled: a.closeToTray });
    if (a.launchAtStartup !== b.launchAtStartup) void syncAutostart(a.launchAtStartup);
  });
}
