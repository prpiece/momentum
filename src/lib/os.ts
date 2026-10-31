/*
 * OS integration for the main window: notifications, the reminder popup, the global quick-add
 * shortcut, close-to-tray, launch at login and the focus ticker. The main window is the only
 * writer; the popup windows send it events ("quickadd:create", "reminder:action").
 */
import { isTauri } from "../db/client";
import { focusPhaseLabel } from "../features/focus/FocusView";
import { createFromText } from "../features/tasks/quickAddSubmit";
import { accentForeground } from "../domain/color";
import { todayLocal } from "../domain/dates";
import type { NotifySettings } from "../domain/types";
import { isDone, targetOf } from "../domain/habits";
import { checkinOf, setCheckin, useHabits } from "../stores/habits";
import { setPhaseEndHandler, tickFocus } from "../stores/focus";
import { useSettings } from "../stores/settings";
import { go, openEvent, openTask, toast } from "../stores/ui";
import { snoozeReminder, startReminders, type ReminderDTO } from "./reminderScheduler";
import { checkForUpdate } from "./updater";
import { setStatus, useData } from "../stores/data";

export type ReminderShow = { dto: ReminderDTO; corner: NotifySettings["corner"] };
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

/** The app mark (assets/app-icon.svg) tinted with the accent, as PNG bytes for the taskbar and tray. */
async function appIconPng(accent: string): Promise<Uint8Array> {
  const mix = (to: number, t: number) => `#${[1, 3, 5].map((i) => Math.round(parseInt(accent.slice(i, i + 2), 16) * (1 - t) + to * t).toString(16).padStart(2, "0")).join("")}`;
  const fg = accentForeground(accent);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 1024 1024">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(255, 0.12)}"/><stop offset="1" stop-color="${mix(0, 0.25)}"/></linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect x="40" y="40" width="944" height="944" rx="220" fill="url(#bg)"/><rect x="40" y="40" width="944" height="944" rx="220" fill="url(#shine)"/>
    <path d="M232 724 C 404 724 528 610 612 380" fill="none" stroke="${fg}" stroke-width="96" stroke-linecap="round"/>
    <path d="M478 400 L 624 296 L 682 470" fill="none" stroke="${fg}" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="776" cy="700" r="64" fill="${fg}" fill-opacity="0.78"/></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")?.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error("Couldn't render the app icon");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function initOs() {
  setInterval(tickFocus, 1000);
  setPhaseEndHandler((_, next) => notifySettings().enabled && notifySettings().focus && notice("Momentum focus", focusPhaseLabel(next)));

  if (!isTauri) return startReminders((r) => deliver(r));

  const [{ listen, emit }, { Window, getCurrentWindow }, { TrayIcon }, notif, shortcut, autostart, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/tray"),
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
  await listen<ReminderAction>("reminder:action", (e) => handleReminderAction(e.payload));
  deliver = (dto) => {
    const { style, sound } = notifySettings();
    if (style !== "popup") osNotify(dto.title, dto.body);
    if (style !== "system") {
      if (sound) chime();
      // The popup sizes and places itself around its cards.
      void emit("reminder:show", { dto, corner: notifySettings().corner } satisfies ReminderShow);
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

  // --- app icon --------------------------------------------------------------
  // The taskbar and tray icons take the accent color (D55).
  const syncIcon = async (accent: string) => {
    try {
      const png = await appIconPng(accent);
      await getCurrentWindow().setIcon(png);
      await (await TrayIcon.getById("momentum"))?.setIcon(png);
    } catch (err) {
      console.error("App icon change failed", err);
    }
  };
  await syncIcon(settings().accent);

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

  // --- updates (D59) ---------------------------------------------------------
  if (settings().checkUpdates) void checkForUpdate();

  useSettings.subscribe((s, prev) => {
    const a = s.settings;
    const b = prev.settings;
    if (a.quickAddShortcut !== b.quickAddShortcut) void bindShortcut(a.quickAddShortcut);
    if (a.closeToTray !== b.closeToTray) void invoke("set_close_to_tray", { enabled: a.closeToTray });
    if (a.launchAtStartup !== b.launchAtStartup) void syncAutostart(a.launchAtStartup);
    if (a.accent !== b.accent) void syncIcon(a.accent);
  });
}
