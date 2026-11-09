/*
 * OS integration for the main window: notifications, the reminder popup, the global quick-add
 * and voice shortcuts, close-to-tray, launch at login and the focus ticker. The main window is the
 * only writer; the popup windows send it events ("quickadd:create", "voice:toggle", "reminder:action").
 */
import { isTauri } from "../db/client";
import { focusPhaseLabel } from "../features/focus/FocusView";
import { contextForView, parseQuickAddCreate, patchForContext, type QuickAddContext } from "../domain/quickAddContext";
import { QUICK_ADD_POPUP_EVENT } from "../features/tasks/QuickAdd";
import { createFromText } from "../features/tasks/quickAddSubmit";
import { accentForeground, accentHex, type AccentId } from "../domain/color";
import { todayLocal } from "../domain/dates";
import type { NotifySettings } from "../domain/types";
import { isDone, targetOf } from "../domain/habits";
import { checkinOf, setCheckin, setCheckinHandler, useHabits } from "../stores/habits";
import { buildSnapshot, parseMiniAction } from "../domain/mini";
import { toggleDone } from "../features/tasks/actions";
import { derive } from "../features/tasks/selectors";
import { pauseFocus, resumeFocus, setPhaseEndHandler, skipPhase, startFocus, stopFocus, tickFocus, useFocus } from "../stores/focus";
import { matchTasks } from "../domain/fuzzy";
import { isRecord } from "../domain/settings";
import { inSmartList } from "../domain/taskViews";
import { INBOX_ID } from "../domain/types";
import { matchVoiceCommand, normalizeTranscript, type CompleteCandidate, type VoiceCommand, type VoicePopupEvent } from "../domain/voice";
import { openVoiceSettings, refreshVoiceModel, voiceCancel, voiceErrorText, voiceStart, voiceStop } from "./voice";
import { useSettings } from "../stores/settings";
import { go, openEvent, openTask, toast, useUi } from "../stores/ui";
import { snoozeReminder, startReminders, type ReminderDTO } from "./reminderScheduler";
import { keyLabel } from "./platform";
import { checkForUpdate } from "./updater";
import { playEvent, playSound } from "./sounds";
import { checkLastWeek, checkTrophies, onCheckin, onLongBreak, onTaskDone } from "./celebrate";
import { setDoneHandler, setStatus, useData } from "../stores/data";
import { showInCurrentView } from "../features/tasks/viewOptions";

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

const notifySettings = () => useSettings.getState().settings.notify;

/** Shows a reminder the way Settings → Notifications says. Replaced with the OS version once Tauri is up. */
let deliver = (dto: ReminderDTO) => {
  if (notifySettings().sound) playSound("chime", 1);
  toast(`${dto.title} · ${dto.body}`, dto.target.kind === "task" ? { label: "Done", run: () => handleReminderAction({ dto, action: "done" }) } : undefined);
};
/** Simple one-line notices (focus phases, quick add), gated by their own setting. */
let notice = (title: string, body: string) => toast(`${title} · ${body}`);
/** Flashes the taskbar button. Set once Tauri is up. */
let flashTaskbar = () => {};

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
  setDoneHandler(onTaskDone);
  setCheckinHandler(onCheckin);
  // A week that just ended, and trophies earned from history (silently, the first time).
  setTimeout(() => {
    checkTrophies();
    checkLastWeek();
  }, 1500);
  // A phase ending is an alarm, so it rings and shows in-app even with notifications off.
  setPhaseEndHandler((_, next) => {
    const n = notifySettings();
    if (next === "long") onLongBreak(); // "done" rings the plain focus-end alarm
    else playEvent("focusEnd", 3);
    toast(`Timer done · ${focusPhaseLabel(next)}`);
    flashTaskbar();
    if (isTauri && n.enabled && n.focus) notice("Momentum focus", focusPhaseLabel(next));
  });

  if (!isTauri) return startReminders((r) => deliver(r));

  const [{ listen, emit }, { Window, getCurrentWindow, UserAttentionType }, { TrayIcon }, notif, shortcut, autostart, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/tray"),
    import("@tauri-apps/plugin-notification"),
    import("@tauri-apps/plugin-global-shortcut"),
    import("@tauri-apps/plugin-autostart"),
    import("@tauri-apps/api/core"),
  ]);
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const settings = () => useSettings.getState().settings;

  // --- notifications -------------------------------------------------------
  let canNotify = await notif.isPermissionGranted();
  if (!canNotify) canNotify = (await notif.requestPermission()) === "granted";
  const osNotify = (title: string, body: string) => {
    if (canNotify) notif.sendNotification({ title, body });
  };
  notice = (title, body) => osNotify(title, body);
  flashTaskbar = () => void getCurrentWindow().requestUserAttention(UserAttentionType.Critical).catch(() => undefined);

  // --- reminder popup ------------------------------------------------------
  // Native toasts on Windows have no action buttons through the plugin, so a small always-on-top
  // popup carries Done / Snooze / Open (PLAN R1).
  await listen<ReminderAction>("reminder:action", (e) => handleReminderAction(e.payload));
  deliver = (dto) => {
    const { style, sound } = notifySettings();
    if (style !== "popup") osNotify(dto.title, dto.body);
    if (style !== "system") {
      if (sound) playSound("chime", 1);
      // The popup sizes and places itself around its cards.
      void emit("reminder:show", { dto, corner: notifySettings().corner } satisfies ReminderShow);
    }
  };
  void startReminders((dto) => deliver(dto));

  // --- global quick add ----------------------------------------------------
  await listen<unknown>("quickadd:create", (e) => {
    const p = parseQuickAddCreate(e.payload);
    if (!p) return;
    const t = createFromText(p.text, patchForContext(p.context, (id) => id in useData.getState().lists), settings().smartParse && !p.raw, () => false, p.spoken ? "spoken" : "typed");
    if (t && notifySettings().enabled && notifySettings().quickAdd) osNotify("Added to Momentum", t.title);
  });
  const showQuickAdd = async (context: QuickAddContext | null) => {
    const w = await Window.getByLabel("quickadd");
    await w?.center();
    await w?.show();
    await w?.setFocus();
    const { lists, tags } = useData.getState();
    await emit("quickadd:focus", {
      context,
      lists: Object.values(lists).filter((l) => !l.archived).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.name),
      tags: Object.values(tags).map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    });
  };
  // `N` with no inline bar on screen (D70): open the popup pre-filled from the current view.
  window.addEventListener(QUICK_ADD_POPUP_EVENT, () => {
    const { view, calAnchor } = useUi.getState();
    void showQuickAdd(contextForView(view, useData.getState().lists, calAnchor));
  });
  /** A global shortcut that can be re-bound from Settings. */
  const binder = (onEvent: (state: "Pressed" | "Released") => void) => {
    let bound: string | null = null;
    return async (accel: string) => {
      if (bound) await shortcut.unregister(bound).catch(() => undefined);
      bound = null;
      try {
        await shortcut.register(accel, (e) => onEvent(e.state));
        bound = accel;
      } catch (err) {
        console.error("Global shortcut registration failed", err);
        toast(`Couldn't register ${keyLabel(accel.replace("CommandOrControl", "Ctrl"))}: another app may be using it. Pick another in Settings.`);
      }
    };
  };
  const onPress = (run: () => void) => binder((state) => state === "Pressed" && run());
  const bindQuickAdd = onPress(() => void showQuickAdd(null));
  const bindMini = onPress(() => void invoke("toggle_mini"));
  await bindQuickAdd(settings().quickAddShortcut);
  await bindMini(settings().miniShortcut);

  // --- voice quick-add (D81) -------------------------------------------------
  // Hold the shortcut (or click the popup's mic) to record; Rust transcribes on release. A voice
  // command runs here; anything else lands in the popup's input to confirm with Enter.
  type VoiceState = { kind: "idle" } | { kind: "starting"; then: "keep" | "stop" | "cancel" } | { kind: "recording" } | { kind: "transcribing" };
  let voice: VoiceState = { kind: "idle" };
  const voiceNow = (): VoiceState => voice; // read through a call: the state changes across awaits
  const toPopup = (e: VoicePopupEvent) => void emit("quickadd:voice", e);
  const runVoiceCommand = async (cmd: Exclude<VoiceCommand, { kind: "complete" }>) => {
    const timer = useFocus.getState().timer;
    const active = timer.status === "running" || timer.status === "paused";
    switch (cmd.kind) {
      case "view":
        void showMain();
        return go(cmd.view);
      case "matrix":
        void showMain();
        return showInCurrentView({ mode: "matrix" });
      case "showCompleted":
        void showMain();
        return showInCurrentView({ showCompleted: true });
      case "openList": {
        const list = Object.values(useData.getState().lists).find((l) => l.name === cmd.name);
        if (!list) return;
        void showMain();
        return go(list.id === INBOX_ID ? "inbox" : `list:${list.id}`);
      }
      case "mini": {
        // Unlike the toggle_mini command, "open" and "close" are idempotent.
        const w = await Window.getByLabel("mini");
        return void (cmd.open ? w?.show() : w?.hide());
      }
      case "focus":
        if (cmd.op === "start") {
          if (timer.status === "idle" || timer.status === "done") startFocus("pomodoro", null);
          if (notifySettings().enabled && notifySettings().focus) osNotify("Momentum focus", "Focus started");
        } else if (cmd.op === "stop") {
          if (active) stopFocus();
        } else if (cmd.op === "pause") pauseFocus();
        else if (cmd.op === "resume") resumeFocus();
        else if (cmd.op === "skip") {
          if (active) skipPhase();
        } else if (active) {
          // "Start a break": the pomodoro's next phase after a focus phase is the break.
          if (timer.phase === "focus") skipPhase();
        } else toast("Start a focus session first; breaks follow it.");
    }
  };
  /** Open tasks that fit a spoken description: Today first, then every open root task (D95). */
  const completeCandidates = (query: string): CompleteCandidate[] => {
    const { tasks, lists } = useData.getState();
    const today = todayLocal();
    const open = derive(tasks, lists).roots.filter((vm) => vm.task.status === "open").map((vm) => ({ id: vm.task.id, title: vm.task.title, today: inSmartList("today", vm, today) }));
    return matchTasks(query, open).map(({ id, title }) => ({ id, title }));
  };
  const startVoice = async (fromPopup: boolean) => {
    if (voiceNow().kind !== "idle") return;
    voice = { kind: "starting", then: "keep" };
    let ready = false;
    try {
      ready = (await refreshVoiceModel()).state === "ready";
    } catch (err) {
      console.error("Voice model status failed", err);
    }
    if (!ready) {
      voice = { kind: "idle" };
      await (await Window.getByLabel("quickadd"))?.hide();
      await showMain();
      openVoiceSettings();
      return;
    }
    // Open the mic first and the popup alongside it, so the first word isn't lost to the popup
    // opening (D94). Parakeet rejects hotwords, so spoken list names rely on fuzzy matching instead.
    const recording = voiceStart().then(
      () => null,
      (err: unknown) => err,
    );
    if (!fromPopup) await showQuickAdd(null);
    toPopup({ kind: "listening" });
    const failed = await recording;
    if (failed !== null) {
      voice = { kind: "idle" };
      return toPopup({ kind: "error", message: voiceErrorText(failed) });
    }
    const now = voiceNow();
    voice = { kind: "recording" };
    if (now.kind === "starting" && now.then === "stop") void stopVoice();
    if (now.kind === "starting" && now.then === "cancel") cancelVoice();
  };
  const stopVoice = async () => {
    const now = voiceNow();
    if (now.kind === "starting") voice = { kind: "starting", then: "stop" };
    if (now.kind !== "recording") return;
    voice = { kind: "transcribing" };
    toPopup({ kind: "transcribing" });
    try {
      const text = normalizeTranscript(await voiceStop());
      const cmd = matchVoiceCommand(text, Object.values(useData.getState().lists).map((l) => l.name));
      const candidates = cmd?.kind === "complete" ? completeCandidates(cmd.query) : [];
      if (cmd?.kind === "complete" && candidates.length) toPopup({ kind: "confirm", text, candidates });
      else if (cmd && cmd.kind !== "complete") {
        await runVoiceCommand(cmd);
        toPopup({ kind: "close" });
      } else if (text) toPopup({ kind: "text", text }); // includes "complete ..." with no match: it becomes a new task
      else toPopup({ kind: "error", message: "Didn't catch that. Keep holding the shortcut while you speak." });
    } catch (err) {
      toPopup({ kind: "error", message: voiceErrorText(err) });
    } finally {
      voice = { kind: "idle" };
    }
  };
  const cancelVoice = () => {
    const now = voiceNow();
    if (now.kind === "starting") voice = { kind: "starting", then: "cancel" };
    if (now.kind !== "recording") return;
    voiceCancel();
    voice = { kind: "idle" };
  };
  // The popup confirmed a spoken "complete ..." (D95); the main window owns the data, so it re-checks the id.
  await listen<unknown>("quickadd:complete", (e) => {
    const id = isRecord(e.payload) ? e.payload.id : null;
    const vm = typeof id === "string" ? derive(useData.getState().tasks, useData.getState().lists).byId.get(id) : undefined;
    if (vm?.task.status === "open") toggleDone(vm.task.id, vm.key);
  });
  await listen("voice:toggle", () => void (voiceNow().kind === "idle" ? startVoice(true) : stopVoice()));
  await listen("voice:cancel", cancelVoice);
  const bindVoice = binder((state) => void (state === "Pressed" ? startVoice(false) : stopVoice()));
  await bindVoice(settings().voiceShortcut);

  // --- mini window (D80) -----------------------------------------------------
  // It reads a compact snapshot and sends actions back; this window applies them like in-app clicks.
  const publishMini = () => {
    const { tasks, lists } = useData.getState();
    const d = derive(tasks, lists);
    const s = settings();
    void emit("mini:state", buildSnapshot(d.roots, d.byId, useFocus.getState().timer, s.pomodoro, s.matrix, todayLocal(), Date.now()));
  };
  let miniTimer: ReturnType<typeof setTimeout> | undefined;
  const publishMiniSoon = () => {
    miniTimer ??= setTimeout(() => {
      miniTimer = undefined;
      publishMini();
    }, 250);
  };
  await listen("mini:hello", publishMini);
  await listen<unknown>("mini:action", (e) => {
    const a = parseMiniAction(e.payload);
    if (!a) return;
    const known = (id: string) => !!useData.getState().tasks[id];
    if (a.type === "toggle") {
      if (known(a.id)) toggleDone(a.id, a.key);
    } else if (a.type === "open") {
      if (!known(a.id)) return;
      void showMain();
      openTask(a.id, a.key);
    } else if (a.op === "start") {
      const t = useFocus.getState().timer.status;
      if ((t === "idle" || t === "done") && (a.taskId === null || known(a.taskId))) startFocus("pomodoro", a.taskId);
    } else if (a.op === "pause") pauseFocus();
    else if (a.op === "resume") resumeFocus();
    else if (useFocus.getState().timer.status === "running" || useFocus.getState().timer.status === "paused") skipPhase();
  });
  useData.subscribe(publishMiniSoon);
  useFocus.subscribe(publishMiniSoon);
  setInterval(publishMini, 60_000); // midnight rolls Today over without any store change
  publishMini();
  // --- app icon --------------------------------------------------------------
  // The taskbar and tray icons take the accent color (D55).
  const syncIcon = async (accent: AccentId) => {
    try {
      const png = await appIconPng(accentHex(accent, "light"));
      await getCurrentWindow().setIcon(png);
      await (await TrayIcon.getById("momentum"))?.setIcon(png);
    } catch (err) {
      console.error("App icon change failed", err);
    }
  };
  await syncIcon(settings().accent);
  await getCurrentWebview().setZoom(settings().scale);

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
    if (a.quickAddShortcut !== b.quickAddShortcut) void bindQuickAdd(a.quickAddShortcut);
    if (a.miniShortcut !== b.miniShortcut) void bindMini(a.miniShortcut);
    if (a.pomodoro !== b.pomodoro || a.matrix !== b.matrix) publishMiniSoon();
    if (a.voiceShortcut !== b.voiceShortcut) void bindVoice(a.voiceShortcut);
    if (a.closeToTray !== b.closeToTray) void invoke("set_close_to_tray", { enabled: a.closeToTray });
    if (a.launchAtStartup !== b.launchAtStartup) void syncAutostart(a.launchAtStartup);
    if (a.accent !== b.accent) void syncIcon(a.accent);
    if (a.scale !== b.scale) void getCurrentWebview().setZoom(a.scale);
  });
}
